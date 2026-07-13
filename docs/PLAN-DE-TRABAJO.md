# Foguito · Plan de trabajo

> ✅ **ESTADO (2026-07-13): roadmap PR-0 → PR-10 COMPLETO y mergeado a `main`.** Producto en
> producción (`https://foguito.com`) pero **inerte** hasta contratar los vendors de §6 (cada
> integración es fail-closed). Estado operativo + deploy → `.claude/HANDOFF.md`; decisiones →
> `docs/adr/`; bitácora → `docs/logbook.md`. Los ● de aceptación de abajo quedan cumplidos como
> test/flujo. Lo que resta es **contratar vendors + acción legal/fiscal**, no código.

> Documento operativo. Traduce los tres briefs (INSTRUCCIONES-GENERALES, design-system,
> estructura-riel) a un plan de construcción ejecutable, partiendo de **clonar el engine
> `marketplace-starter`** (ver §Base). Regla base heredada: **si algo acá contradice los
> pilares §2 de INSTRUCCIONES-GENERALES, ganan los pilares.** Seguridad de menores es
> bloqueante absoluto (requisito #0).

## Base: `marketplace-starter`, no Velora+

**Decisión (2026-07-10):** la base es **`existenslump-dot/marketplace-starter`**, el engine
config-driven multi-vertical del que Velora+ es un producto derivado. Es mejor punto de
partida que Velora+ porque:

- **Es el motor limpio, no un producto lleno de cruft.** Branding, país/moneda/locale, taxonomía
  y features salen de `src/config/marketplace.config.ts` + env → **rebrand = editar config**, no
  cirugía find/replace. No hay que stripear nada AR/escort (Velora sí).
- **Didit KYC ya está implementado** en el engine (`src/lib/didit/*` + `/api/verification/
  didit-session` + `src/lib/kyc/` pluggable). El PR-1 arranca ~80% hecho.
- **Feature flags** (`FEATURE_KYC/PAYMENTS/CREDITS/STORIES/REVIEWS/GEO_BLOCK`): prendés lo que
  querés (KYC on, credits on), apagás lo que no (stories/reviews/blog).
- **Pagos como paquete swappable** (`packages/payments-kit`, provider `mercadopago|stripe|none`)
  → seam limpio para enchufar el riel MoR + payout de foguito sin arrancar de cero.
- **Watermark de Cloudinary** ya cableado (`NEXT_PUBLIC_CLOUDINARY_WATERMARK_ID`) — insumo del PR-5.
- **Baseline de migraciones limpio** (14, genéricas) vs. el squash escort de Velora.

⚠️ **Caveat:** `marketplace-starter` es el **superset / source-of-truth de un producto vendible
(Kelflow)**, con tooling de derive (`tooling/split/derive.mjs`) y docs internas seller-only
(secciones `DERIVE_OMIT`, refs a `KELFLOW-*`). Al basar foguito en él hay que **NO arrastrar la
capa seller**: correr el derive para emitir una base limpia, o quitar `tooling/split/`, las
secciones `DERIVE_OMIT` y las refs internas. El derive existe justo para esto (borra docs
internas y falla-cerrado ante leaks de identidad).

---

## 0. En una línea

Foguito = plataforma de suscripción de contenido adulto (tipo OnlyFans) que **le paga a
las creadoras** (revenue-share). Es la única superficie del ecosistema con **payout a
terceros** → la de mayor exposición regulatoria. La cara es pop y de fuego; atrás corre
verificación 18+, 2257, CSAM y AML de primer nivel.

**El engine `marketplace-starter` resuelve ~50% de la infra pesada** (auth sin SDK, KYC Didit,
storage privado con RLS, moderación admin, 2FA, auditoría, rate-limit, backups, CSP/headers,
geo, i18n, watermark, payments-kit swappable). Lo que **no** tiene y hay que construir es todo
lo de plataforma-de-contenido-con-pago: entitlements/paywall, ledger de créditos doble entrada,
entrega firmada, age-gate real del consumidor, 2257, CSAM y el riel de pagos MoR + payout.

---

## 1. Punto de partida — qué trae el engine y qué es nuevo

### ♻️ Ya viene en el engine (config + rebrand, casi cero código)

| Subsistema del engine | Archivos clave | Para qué sirve en Foguito |
|---|---|---|
| **Auth sin SDK** (dodge del lock-hang) | `src/lib/supabase/direct.ts`, `client.ts`, `middleware.ts` | login email + OAuth |
| **KYC Didit (¡ya implementado!)** | `src/lib/didit/*`, `src/lib/kyc/*`, `/api/verification/didit-session`, `/api/admin/verification` | verificación 18+ de creadora — PR-1 arranca ~80% hecho |
| **2FA TOTP admin** | `src/lib/totp*.ts`, `/api/auth/totp/*` | gate de admin/moderación |
| **Identidad en bucket privado** | `identity-documents` bucket + RLS, `/api/admin/identity-{doc,upload}` | docs KYC/2257 cifrados (`DIDIT_PAYLOAD_KEY`) |
| **Retención de PII** | `/api/cron/identity-retention`, `IDENTITY_RETENTION_DAYS` | minimización de datos (age-gate/KYC) |
| **Moderación admin + guard DB** | `/admin`, `/api/admin/approve-post`, trigger `posts_guard_moderation` | cola pre-publicación de contenido |
| **Auditoría rica** | `src/lib/audit.ts` (`recordAudit`), tabla `audit_log` | audit trail inmutable (2257, takedown, payout) |
| **Rate-limit** | `src/lib/rateLimit.ts` (Upstash + fallback) | anti-abuso en upload/pago/API |
| **Guards de API** | `src/lib/clients/require-admin.ts`, `same-origin.ts` | proteger rutas privilegiadas |
| **Email** | `src/lib/emails.ts`, Resend | transaccional |
| **Backups + DR cifrado** | `src/lib/backup/**`, crons, off-site Drive AES-GCM | mismo sistema, agregar tablas nuevas al manifest |
| **Geo** | `src/lib/geo.ts` | base del age-gate por jurisdicción del viewer |
| **Tiers** | `src/lib/tiers.ts`, `tier-settings.ts` | mapea a temperatura (Tibio→A todo fuego) |
| **CSP / headers / robots / security.txt** | `next.config.ts`, `middleware.ts` | hardening día 1 (ajustar dominio a foguito.com) |
| **Branding config-driven** | `src/config/marketplace.config.ts` (`brand.colors` → `--brand-*` → `--v-*`) | **rebrand = editar config**, no find/replace |
| **Payments-kit swappable** | `packages/payments-kit` (provider `mercadopago\|stripe\|none`) | seam para enchufar el riel MoR + payout |
| **Media + watermark** | Cloudinary, `NEXT_PUBLIC_CLOUDINARY_WATERMARK_ID` | insumo del PR-5 (entrega firmada) |
| **Build config** | `next.config.ts` (React Compiler), `vitest`, eslint, tsconfig, `components.json` | arranca compilando y testeando |

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

### 🔻 Se APAGA / no se deriva del engine (no aplica)

`blog`/Foro, `stories`, `reviews` de listings, el `payments-kit` MercadoPago: **se apagan por
flag o no se derivan** (`FEATURE_*=false`). Sin strip manual — el engine ya los tiene gateados.
El producto listings/city-feed se reemplaza por el de creadoras+contenido (PRs 5/6).

---

## 2. Estrategia de bootstrap — "derivar el engine y configurar"

Camino recomendado (mucho más rápido que Velora+: no hay strip, el rebrand es config):

1. **Emitir una base limpia del engine.** Correr `node tooling/split/derive.mjs` en
   `marketplace-starter` para obtener `out/base` **con el KYC add-on** (Didit) — o copiar el
   superset y quitar la capa seller (`tooling/split/`, secciones `DERIVE_OMIT`, refs `KELFLOW-*`).
   Copiar ese árbol limpio a `foguito`.
2. **Rebrand por config**: editar `src/config/marketplace.config.ts` → `brand.colors`
   (`primary` ember `#FF5330`, `dark` night `#17101A`, `light` `#FFF6EF`) + `name: 'Foguito'`;
   fuentes → Unbounded/Space Grotesk/DM Sans/DM Mono (ver `docs/BRAND.md`).
3. **Flags**: `FEATURE_KYC=true`, `KYC_PROVIDER=didit`, `FEATURE_CREDITS=true`;
   `FEATURE_STORIES/REVIEWS/BLOG=false`, `FEATURE_PAYMENTS=false` (foguito trae su riel MoR).
4. **Mercado/dominio**: `MARKET_COUNTRY=BR,CL,AR`, `NEXT_PUBLIC_SITE_DOMAIN=foguito.com`, CSP/
   `robots`/`security.txt`/emails → foguito.com.
5. **Supabase nuevo proyecto** (no reusar el del engine). Aplicar las 14 migraciones baseline
   del engine + las nuevas del §4 (creators/content/2257/entitlements/ledger/payouts/age-gate).
6. A partir de ahí, los PRs 0→10 agregan lo nuevo. `1 PR = 1 rama = 1 review`.

> El engine es un producto de *listings/directory*; foguito es *suscripción de contenido*. El
> **infra** se reusa casi entero; el **producto** (creadoras + paywall + entitlements + ledger +
> payout) es fork, no config. Por eso foguito **forkea** el engine (no es solo otra config suya).

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
| **0** | Fundaciones: derivar engine + rebrand config + flags; esquema que impide contenido sin verificación; RLS; age-gate skeleton | build, auth, CSP, RLS, config-driven brand | tablas §4, triggers gate | ● | Opus (review) + Code |
| **1** | Verificación edad/identidad de creadora (18+) con **Didit** | **Didit ya implementado** (`src/lib/didit/*`, `/api/verification/didit-session`) | activar KYC_PROVIDER=didit + hooks re-verify + gate de publicación | ● | Opus |
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
**PR-1** — el engine ya trae la integración Didit; foguito la **activa** (`KYC_PROVIDER=didit`
+ credenciales) y la hace **bloqueante**: Didit devuelve 18+ verificado antes de habilitar
onboarding; falla → sin publicación. Re-verificación disparable.
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
| **Didit** (cuenta) | KYC creadora 18+ — **integración ya en el engine**, falta la cuenta/credenciales (free tier 500/mes) | PR-1, PR-4 |
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
