# Foguito · Plan de trabajo

> Documento operativo. Traduce los tres briefs (INSTRUCCIONES-GENERALES, design-system,
> estructura-riel) a un plan de construcción ejecutable, partiendo de **clonar Velora+**.
> Regla base heredada: **si algo acá contradice los pilares §2 de INSTRUCCIONES-GENERALES,
> ganan los pilares.** Seguridad de menores es bloqueante absoluto (requisito #0).

---

## 0. En una línea

Foguito = plataforma de suscripción de contenido adulto (tipo OnlyFans) que **le paga a
las creadoras** (revenue-share). Es la única superficie del ecosistema con **payout a
terceros** → la de mayor exposición regulatoria. La cara es pop y de fuego; atrás corre
verificación 18+, 2257, CSAM y AML de primer nivel.

**Velora+ es un excelente punto de partida** porque ya resuelve ~40% de la infra pesada
(auth sin SDK, KYC en storage privado con RLS, moderación admin, 2FA, auditoría,
rate-limit, backups cifrados, CSP/headers). Lo que **no** tiene y hay que construir es todo
lo de plataforma-de-contenido-con-pago: entitlements, ledger de créditos, entrega firmada,
age-gate real, 2257, CSAM y el riel de pagos MoR + payout.

---

## 1. Punto de partida — qué se reusa de Velora+ y qué es nuevo

### ♻️ Se REUSA casi tal cual (portar + re-brandear)

| Subsistema Velora+ | Archivos clave | Para qué sirve en Foguito |
|---|---|---|
| **Auth sin SDK** (dodge del lock-hang) | `src/lib/supabase/direct.ts`, `client.ts`, `middleware.ts` | login email + Google OAuth idéntico |
| **2FA TOTP admin** | `src/lib/totp*.ts`, `/auth/totp`, `/api/auth/totp/*` | gate de admin/moderación |
| **KYC / identidad en bucket privado** | `identity-documents` bucket + RLS, `/api/admin/identity-{doc,upload}`, `src/components/verify/` | base para verificación de creadora (se le enchufa Didit) |
| **Moderación admin + guard DB** | `/admin`, `/api/admin/approve-post`, trigger `posts_guard_moderation` | cola pre-publicación de contenido |
| **Auditoría rica** | `src/lib/audit.ts` (`recordAudit`), tabla `audit_log` | audit trail inmutable (2257, takedown, payout) |
| **Rate-limit** | `src/lib/rateLimit.ts` (Upstash + fallback) | anti-abuso en upload/pago/API |
| **Guards de API** | `src/lib/clients/require-admin.ts`, `same-origin.ts` | proteger rutas privilegiadas |
| **Email** | `src/lib/emails.ts`, Resend | transaccional |
| **Backups + DR cifrado** | `src/lib/backup/**`, crons, off-site Drive AES-GCM | mismo sistema, agregar tablas nuevas al manifest |
| **Geo** | `src/lib/geo.ts` | base del age-gate por jurisdicción del viewer |
| **Tiers** | `src/lib/tiers.ts`, `tier-settings.ts` | mapea a temperatura (Tibio→A todo fuego) |
| **CSP / headers / robots / security.txt** | `next.config.ts`, `middleware.ts`, `/api/monitoring/csp` | hardening desde el día 1 (ajustar `SELF_ORIGIN` a foguito.com) |
| **Build config** | `next.config.ts` (React Compiler), `vitest`, eslint, tsconfig, `components.json` (shadcn) | arranca compilando y testeando |

### 🆕 Se CONSTRUYE nuevo (no existe en Velora+)

| Nuevo | Por qué Velora+ no lo tiene | PR |
|---|---|:--:|
| **Age-gate real del consumidor** por jurisdicción | Velora solo tiene `aviso-adultos` (checkbox/geo), no verificación | PR-4 |
| **2257** (registros de performers + vínculo a cada pieza) | inexistente | PR-2 |
| **Detección de CSAM** pre-publicación (vendor externo) | inexistente | PR-3 |
| **Entitlements** (suscripción / PPV / tips) | Velora es directorio de avisos, no hay paywall | PR-6 |
| **Entrega de contenido firmada + watermark** | Velora usa Cloudinary unsigned público | PR-5 |
| **Pagos inbound MoR** (acquirer high-risk + on-ramp card→USDT) | Velora usa MercadoPago/NOWPayments inbound-only | PR-7 |
| **Crédito de bucle cerrado (foguitos) + ledger doble entrada** | inexistente | PR-6 |
| **Payout regulado a creadoras** (VASP/PSP + Travel Rule) | Velora **no hace payout** (inbound-only) | PR-8 |
| **AML / sanciones / PEP** en las tres superficies | inexistente | PR-8/10 |
| **Didit** como proveedor de KYC | Velora hace KYC manual por admin | PR-1 |

### 🔻 Se DESCARTA de Velora+ (no aplica)

Directorio por ciudad/SEO de escorts, MercadoPago AR, `blog`, `stories`, `musa`, categorías
de escort, `promo`/`boost`, reviews de avisos, vanity slugs de aviso. Se saca en el strip
inicial (PR-0) para no arrastrar superficie muerta.

---

## 2. Estrategia de bootstrap — "clonar Velora+ y adaptar"

Camino recomendado (más rápido que greenfield: conserva auth, RLS, build y CSP probados):

1. **Copiar el árbol de Velora+** a `foguito` (sin `.git`, sin `node_modules`, sin `docs`
   específicos de SEO/AR).
2. **Rebrand de tokens**: reemplazar Noir&Gold (`#080808`/`#C5A059`) por el sistema de fuego
   (`docs/BRAND.md`), fuentes Cormorant/Montserrat → Unbounded/Space Grotesk/DM Sans/DM Mono.
3. **Strip**: borrar rutas/lib de §1.🔻 (directorio, blog, stories, musa, MP).
4. **Renombrar dominio**: `SELF_ORIGIN`, CSP, `robots`, `security.txt`, emails → `foguito.com`.
5. **Supabase nuevo proyecto**: no reusar el de Velora (datos y RLS distintos). Migraciones
   nuevas desde cero (el baseline de Velora es de escorts) — ver §4.
6. A partir de ahí, los PRs 0→10 agregan lo nuevo. `1 PR = 1 rama = 1 review`.

> Alternativa (selective port): arrancar Next.js limpio y **lift** solo los subsistemas de
> §1.♻️. Más limpio, más lento. Recomiendo clonar-y-adaptar por velocidad; el strip de §1.🔻
> deja el árbol chico igual.

---

## 3. Stack

Idéntico a Velora+ (ya validado): **Next.js 16 App Router + React 19 (React Compiler ON) +
Tailwind v4 + Supabase (Postgres + Auth + Storage + RLS) + Vitest**. Deploy en **Vercel**.
Rate-limit Upstash. Email Resend. Observabilidad Sentry. Se agregan: proveedor KYC (Didit),
vendor CSAM, acquirer high-risk + on-ramp, partner de payout VASP/PSP, screening AML.

---

## 4. Modelo de datos nuevo (núcleo)

Tablas nuevas mínimas (RLS owner/admin desde el día 1, patrón `profiles_guard_privileged`
de Velora):

- `creators` — perfil de creadora: `kyc_status`, `didit_session_id`, `age_verified_at`,
  `payout_kyc_status`, `sanctions_status`, `country`, seudónimo. **Sin verificación 18+ →
  no publica** (enforced por trigger, no solo cliente).
- `performers_2257` — cada persona que aparece en contenido (creadora + colaboradores):
  legal name (cifrado), doc, fecha de nacimiento verificada, custodio de records.
- `content` — pieza de contenido: `status` (`uploaded`→`csam_scanning`→`in_review`→
  `published`/`rejected`), `visibility` (tier/PPV), `creator_id`, `media_ref` (path privado).
  **Nada `published` sin `csam_pass=true` + 2257 completo de todos los performers** (trigger).
- `content_performers` — N:M content↔performers_2257 (el gate 2257).
- `subscriptions` / `entitlements` — quién puede ver qué (tier vigente, PPV comprado, expiración).
- `credit_ledger` — **doble entrada**, append-only. Saldo de foguitos = suma de asientos.
  No redimible, no transferible (enforced en DB + app). Idempotencia por `idempotency_key`.
- `payouts` — revenue-share a creadora: `status`, `travel_rule_ref`, `sanctions_ref`,
  `tax_withholding`, `vasp_tx_id`. Gated por KYC + screening + registro fiscal.
- `moderation_events` / `takedowns` — cola, SLA, propagación de remoción, export a autoridad.
- `age_gate_verifications` — verificación del viewer por jurisdicción (minimización de datos).
- `audit_log` — reusar el de Velora (esquema rico) para todo lo inmutable.

---

## 5. Roadmap por PRs

`1 PR = 1 rama = 1 review`. No se avanza sin criterios en verde. ● = bloqueante de seguridad.
Modelo sugerido por rol (de INSTRUCCIONES §10).

| PR | Qué | Reusa de Velora+ | Nuevo | ● | Modelo |
|:--:|-----|---|---|:--:|---|
| **0** | Fundaciones: clonar+strip+rebrand; esquema que impide contenido sin verificación; RLS; age-gate skeleton | build, auth, CSP, RLS patterns | tablas §4, triggers gate | ● | Opus (review) + Code |
| **1** | Verificación edad/identidad de creadora (18+) con **Didit** | KYC bucket, `/verify`, admin | integración Didit + hooks re-verify | ● | Opus |
| **2** | **2257** + vínculo con contenido | audit, storage privado cifrado | `performers_2257`, gate de publicación | ● | Opus |
| **3** | Moderación + **detección de CSAM** (núcleo) | cola admin, `posts_guard_moderation` | vendor hash-matching + clasificador + reporte NCMEC | ● | **Opus (review obligatorio)** + Sonnet |
| **4** | Age-gate del consumidor por jurisdicción | `geo.ts`, `aviso-adultos` | verificación real (no checkbox), BR ECA Digital | ● | Sonnet |
| **5** | Gestión y entrega de contenido (URLs firmadas, watermark) | `/api/media/signed-url`, storage | pipeline de entrega + watermark + expiración | | Sonnet |
| **6** | Entitlements (suscripción/PPV/tips) + **ledger** foguitos | tiers | paywall, `credit_ledger` doble entrada | | Sonnet |
| **7** | Pagos inbound (multi-procesador) + hold | patrón webhook crypto de Velora | acquirer high-risk + on-ramp card→USDT, PAN cero | | Sonnet + Opus (review dinero) |
| **8** | Revenue-share ledger + **payout regulado** a creadoras | audit, ledger | VASP/PSP + Travel Rule + sanciones + fiscal | ● | Opus |
| **9** | Quejas, takedown, cooperación con autoridades | admin, audit | SLA, propagación, export | | Sonnet |
| **10** | AML, sanciones, hardening, observabilidad | Sentry, CSP, backups, rate-limit | screening batch, threat-model final | ● | Opus |

### Detalle de criterios de aceptación (los ● son gates de merge)

**PR-0** — `content` no puede pasar a `published` sin `creator.kyc_status=verified`; RLS niega
lectura de contenido pagado sin entitlement; age-gate skeleton bloquea el árbol. Test que lo prueba.
**PR-1** — Didit devuelve 18+ verificado antes de habilitar onboarding; falla de verificación
→ sin publicación. Re-verificación disparable.
**PR-2** — contenido con ≥1 performer sin registro 2257 completo = **no publicable** (probado).
**PR-3** — todo upload pasa hash-matching **antes** de hacerse visible; hit → bloqueo duro +
preservación de evidencia + reporte automático a NCMEC; señal "posible menor" → mismo flujo.
**Contratar el servicio de CSAM ANTES de escribir el PR-3** (DoD de INSTRUCCIONES).
**PR-4** — age-gate sigue la jurisdicción del **viewer** (no del server); autodeclaración
insuficiente; Brasil/US-states/UK/EU cubiertos.
**PR-7** — la plataforma nunca recibe/almacena PAN; el cargo figura como compra de cripto;
crédito resultante no-redimible; multi-procesador (no dependencia de uno solo).
**PR-8** — ninguna transferencia a creadora sin KYC + screening sanciones + Travel Rule +
registro fiscal; ledger doble entrada cuadra; idempotencia.
**PR-10** — screening en las **tres** superficies (creadora, consumidor, payout); secretos
fuera del código/CSP; PII scrubbed.

---

## 6. Servicios externos a contratar (antes de sus PRs)

| Servicio | Para | Bloquea |
|---|---|---|
| **Didit** | KYC creadora 18+ + edad + PEP/sanciones | PR-1, PR-4 |
| **CSAM vendor** (Thorn Safer / PhotoDNA / IWF) | hash-matching pre-publicación | **PR-3 (contratar ANTES)** |
| **NCMEC CyberTipline** (alta de reporter) | reporte obligatorio | PR-3 |
| **Acquirer high-risk** (CCBill / Segpay / Epoch / Verotel) | pagos inbound MoR | PR-7 |
| **On-ramp card→USDT licenciado** | salto tarjeta→cripto (PAN cero) | PR-7 |
| **Partner de payout (VASP/PSP)** | revenue-share a creadoras | PR-8 |
| **Travel Rule** (Notabene / TRP) | FATF para cripto | PR-8 |
| **Screening AML/sanciones** (ComplyAdvantage / Chainalysis) | las tres superficies | PR-8/10 |
| Abogado adulto+pagos por mercado; contador cross-border | validación legal/fiscal | previo a prod |

---

## 7. Variables de entorno

Ver **`.env.example`** (completo, agrupado por PR). Resumen de bloques: App/Supabase/OAuth/
Turnstile (PR-0) · Didit (PR-1) · CSAM+NCMEC (PR-3) · Age-verify (PR-4) · Media firmada (PR-5)
· Ledger (PR-6) · Acquirer+On-ramp (PR-7) · Payout+Travel-Rule+Sanciones (PR-8) · Upstash/
Resend/Sentry/Cron/Backups (PR-0/10).

## 8. Assets a cargar

Ver **`docs/ASSETS.md`**. Los 4 SVG master de marca ya están en `public/brand/`. Falta
exportar favicons/PWA/OG y subir wordmark + assets de landing.

---

## 9. Guardrails y Definition of Done

Bloqueantes (de INSTRUCCIONES §12), verificados como test/flujo, no como política:

- [ ] Ningún contenido publicable sin performer verificado 18+ y 2257 completo (probado).
- [ ] CSAM gate activo y bloqueante pre-publicación, con reporte automático a NCMEC.
- [ ] Señal "posible menor" → bloqueo + preservación + reporte, como flujo implementado.
- [ ] Age-gate del consumidor por jurisdicción (incl. Brasil ECA Digital); no autodeclaración.
- [ ] Plataforma = merchant of record; el fan nunca paga directo a la creadora.
- [ ] Ingreso: PAN cero, crédito no-redimible, multi-procesador.
- [ ] Payout gated por KYC + Travel Rule + sanciones + registro fiscal.
- [ ] Takedown propaga remoción dentro del SLA; export a autoridades funciona.
- [ ] Secretos limpios; PII scrubbed; screening en las tres superficies.
- [ ] Servicio de detección de CSAM contratado **antes** de escribir el PR-3.

> Diseño + ingeniería, no asesoría legal/fiscal. Validar con abogado de contenido adulto +
> pagos por mercado, contador cross-border, y contratar el CSAM vendor antes de producción.
