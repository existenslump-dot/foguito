# Foguito · Threat model AML / hardening (PR-10)

Modelo de amenazas conciso de la capa **AML / sanciones / hardening** cerrada en PR-10.
Acompaña (no reemplaza) a `docs/PLAN-DE-TRABAJO.md`. Criterio de aceptación de PR-10
(`docs/PLAN-DE-TRABAJO.md` línea 194):

> **PR-10** — screening en las **tres** superficies (creadora, consumidor, payout);
> secretos fuera del código/CSP; PII scrubbed.

Este doc registra cómo se satisface cada cláusula.

---

## 1. Las tres superficies de screening AML

Foguito mueve dinero en tres direcciones; cada una tiene su propio corte de sanciones
(OFAC/UN/EU/…). El screening SIEMPRE pasa por el motor único `screenSubject`
(`src/lib/aml/index.ts`), que: (a) llama al provider, (b) deja una fila en el trail
append-only `sanctions_screenings`, y (c) estampa la columna fast-path que gatea el
flujo. Ninguna ruta llama al provider de sanciones directo.

| Superficie | Cuándo se screenea | Gate / flag | Entrada |
|---|---|---|---|
| **Creadora (onboarding)** | Admin corre `/api/admin/creators/[id]/screen` | `creators.sanctions_status` (`unscreened`/`clear`/`review`/`hit`) — el payout exige `clear` | `subject_type='creator'` |
| **Consumidor (money-in)** | Admin corre `/api/admin/consumers/[id]/screen`; batch nocturno lo refresca | `profiles.consumer_sanctions_status` — un `hit` retiene la orden en `held_aml` | `subject_type='consumer'` |
| **Payout (money-out)** | Inline en cada `send` de `/api/admin/payouts/[id]/advance` (defensa en profundidad) | Re-screen; `≠ clear` ⇒ `held`, NO se transfiere | `subject_type='payout'` |

**Re-screening batch** (`/api/cron/aml-rescreen`, diario 04:00 UTC): una entidad `clear`
hoy puede convertirse en `hit` mañana. El cron re-screenea, oldest-first, un batch acotado
(50/superficie) de creadoras y de **consumidores pagadores** (`≥1 foguito_orders`) cuyo
`sanctions_screened_at` es NULL o más viejo que `AML_RESCREEN_DAYS` (default 30). Nunca
re-screenea un `hit` (ya está en el corte duro; salir requiere revisión manual). Un throw
por sujeto se cuenta como `failure` y NO aborta el batch.

## 2. Postura fail-closed del provider

`src/lib/payouts/provider/index.ts` — el screening embarca **inerte**:

- **Sin `SANCTIONS_API_KEY`** → `StubSanctionsProvider`. En **producción** el stub SIEMPRE
  devuelve `review` (jamás auto-clarea). En dev/CI es determinístico por `subjectId`
  (sentinels `sanctions-hit`/`sanctions-review`, default `clear`) para poder testear el
  flujo completo sin red.
- **Con `SANCTIONS_API_KEY`** → `VendorSanctionsProvider` (esqueleto): `screen()` **tira**
  hasta que se cablee el vendor real. Un throw ⇒ el caller responde 502 / deja el payout
  en `held` / no acredita. **Nunca** un `clear` a ciegas.

Consecuencia: hasta contratar un vendor real, ninguna elegibilidad AML se otorga en prod.
El `held_aml` y el `held` de payout se acumulan para revisión manual.

## 3. Trail append-only `sanctions_screenings`

Una fila por screen, en cualquiera de las tres superficies (`subject_type`, `subject_id`,
`status`, `provider`, `ref`, `screened_at`). **Deny-all RLS** (`ENABLE` + `FORCE ROW LEVEL
SECURITY`, cero políticas): sólo el `service_role` (que bypassa RLS) escribe/lee — ni la
creadora ni el fan ven jamás el trail. Toda escritura entra por `getSupabaseAdmin()`.

Las columnas fast-path están **write-guardeadas por trigger**, no por disciplina de cliente:

- `profiles.consumer_sanctions_status` / `consumer_screened_at` → `profiles_guard_aml`
  (un fan NO se puede auto-clarear vía PostgREST directo; se coacciona a OLD/default).
- `creators.sanctions_status` / `sanctions_screened_at` → `creators_guard_privileged`.

## 4. Gate de money-in `held_aml`

`foguito_orders.status` incluye `held_aml`. La RPC `purchase_foguitos` (SECURITY DEFINER,
service-role only) lee `profiles.consumer_sanctions_status` del comprador: si es `hit`,
setea la orden en `held_aml` y **NO acredita** el ledger. El dinero ya settleó en el
procesador → el webhook (`/api/webhooks/foguitos/nowpayments`) **ackea 200** ante `aml_hold`
(un 500/reintento no levantaría el hold) y audita `foguitos_aml_hold`. Idempotente: una
re-entrega sobre `held_aml` devuelve `aml_hold` sin re-tocar. (`review`/`clear`/`none`
acreditan normal — el `hit` es el único corte duro en money-in; el payout a creadora está
screeneado aparte.)

## 5. Manejo de secretos — env only, nunca código/CSP/público

- Todos los secretos viven en env-vars (`.env.example` los marca `# SECRET`) y se leen
  server-side (`getSupabaseAdmin`, `sanctionsApiKey()`, `CRON_SECRET`, `NOWPAYMENTS_IPN_SECRET`,
  …). Nunca se hornean en el bundle ni en headers públicos.
- La **CSP** (`next.config.ts`) no interpola ningún secreto: su único valor derivado de env
  es `CSP_REPORT_URI`, construido desde `NEXT_PUBLIC_SENTRY_DSN` (DSN público por diseño).
- Ningún nombre `NEXT_PUBLIC_*` contiene `SECRET`/`SERVICE_ROLE`/`PRIVATE` (esas vars van al
  browser). El `NEXT_PUBLIC_SUPABASE_ANON_KEY` es la anon key (pública, gobernada por RLS).
- **Guard automatizado:** `src/lib/security/no-secrets.test.ts` falla el build si un secreto
  se cuela en `next.config.ts`/la CSP o si un `NEXT_PUBLIC_*` esconde un secreto en el nombre.

## 6. PII scrubbed en logs / Sentry

- **Logs de app:** los `console.error` de los paths AML loguean sólo tipo + id opaco + error
  — **nunca** nombre legal, email, IP ni paths de documentos. `screenSubject` recibe la PII
  (para el match del vendor) pero NO la persiste en el trail ni la loguea.
- **Sentry:** `src/lib/observability/scrub.ts` (`scrubEvent`) corre en `beforeSend` y
  `beforeSendTransaction` de los **tres** runtimes (`sentry.{client,server,edge}.config.ts`),
  compuesto con el tagging existente. Quita antes de enviar: `request.cookies`, headers
  `authorization`/`cookie`/`x-nowpayments-sig` (case-insensitive), reduce `user` a `{ id }`
  (fuera email/ip_address/username) y borra `server_name`. Defensivo (nunca tira).
- El colector CSP (`report-uri` → Sentry server-side) no expone el DSN en un header público.

---

## 7. Go-live checklist

Antes de encender dinero real / salir de la postura inerte:

**Vendors a contratar y cablear** (cada uno tiene su esqueleto fail-closed listo):

- [ ] **Sanciones/PEP** — `SANCTIONS_SCREENING_PROVIDER` + `SANCTIONS_API_KEY`; implementar
      `VendorSanctionsProvider.screen()` (mapear `clear`/`review`/`hit` + `ref`).
- [ ] **KYC creadora (Didit)** — `DIDIT_API_KEY` / `DIDIT_WORKFLOW_ID` / `DIDIT_WEBHOOK_SECRET`
      / `DIDIT_PAYLOAD_KEY`.
- [ ] **Age-verify consumidor** — `NEXT_PUBLIC_AGE_VERIFY_PROVIDER` + `AGE_VERIFY_API_KEY` +
      `AGE_VERIFY_WEBHOOK_SECRET`.
- [ ] **CSAM** — `CSAM_VENDOR` + `CSAM_API_KEY` + `CSAM_WEBHOOK_SECRET`; NCMEC
      (`NCMEC_REPORT_API_KEY` / `NCMEC_REPORT_ORG_ID`). **Bloqueante Pilar #0.**
- [ ] **Money-in (MoR)** — `NOWPAYMENTS_API_KEY` + `NOWPAYMENTS_IPN_SECRET` (u otro procesador).
- [ ] **VASP/PSP payout** — `PAYOUT_PARTNER` + `PAYOUT_API_KEY` + `PAYOUT_WEBHOOK_SECRET`;
      implementar `VaspPayoutProvider.sendPayout()`.
- [ ] **Travel Rule** — `TRAVEL_RULE_PROVIDER` + `TRAVEL_RULE_API_KEY`.

**Config / flags:**

- [ ] Fijar precios/packs del catálogo y la tasa `foguitos_per_usd()` en la DB (la de display
      `FOGUITOS_PER_USD_DISPLAY` debe coincidir).
- [ ] `AML_RESCREEN_DAYS` (default 30) según la política de frescura.
- [ ] Flags on: `FOGUITOS_PAYMENTS_ENABLED=true`, `PAYOUT_ENABLED=true` (recién tras cablear
      los vendors — el webhook verifica firma siempre, independiente del flag).
- [ ] Backups off-site: `BACKUP_ENCRYPTION_KEY` seteada y **guardada SEPARADA** de los backups.

**Operativo:**

- [ ] `CRON_SECRET` seteado (los crons fallan-closed sin él) y verificar que el schedule
      `0 4 * * *` de `aml-rescreen` quedó en Vercel.
- [ ] Verificar Sentry en prod: eventos llegan **sin** cookies/headers de auth/PII de usuario.
- [ ] **Rotar/revocar cualquier PAT temporal de la DB** usado durante el desarrollo (MCP /
      migraciones manuales) antes de exponer el proyecto.
- [ ] Confirmar que el trail `sanctions_screenings` y el gate `held_aml` funcionan end-to-end
      con el vendor real (no sólo con el stub).
