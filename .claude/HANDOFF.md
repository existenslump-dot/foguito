# HANDOFF — Foguito

Estado operativo vivo + gotchas para la próxima sesión. Complementa `CLAUDE.md` (arquitectura),
`docs/adr/` (decisiones), `docs/logbook.md` (bitácora) y `docs/security/threat-model.md` (amenazas
+ go-live). **Leelo antes de tocar deploy, DB, o integraciones externas.**

Última actualización: **2026-07-13** — roadmap PR-0→10 COMPLETO + primer deploy a prod.

---

## Estado macro

- **Roadmap PR-0→10 COMPLETO.** Todo mergeado a `main`. Cada PR pasó revisión adversarial (Opus,
  cero críticos/altos), el gate completo (`tsc` + `lint` + tests + `next build` + `build:kit`) y —
  los que tocan DB — validación rollback-wrapped en la DB viva.
- **En prod pero INERTE hasta cablear vendors.** El sitio levanta en `https://foguito.com` con lo
  mínimo (Supabase + dominio + SSL + Turnstile + Cloudinary). Todos los vendors de compliance/pagos
  son **fail-closed**: sin API key, la feature no corre y el stub jamás clarea en prod.

## Deploy / infra (detalle)

- **Vercel Pro**, proyecto `foguito`, team `velora-es` (`team_5XVPhfDpQfLxmvcWhEew76xi`).
  ⚠️ El conector MCP de Vercel de la sesión de setup sólo tenía scope sobre `velora-plus` (403 sobre
  `foguito`) — si necesitás leer logs de foguito por MCP, hay que ampliar el scope del token.
- **Dominio:** apex `foguito.com` canónico, `www` 308→apex. Cloudflare DNS, 2× **CNAME** al target
  per-project de Vercel (`…vercel-dns-016.com`), **nube GRIS (DNS only)**. Cambiar a naranja rompe
  el SSL. El apex usa CNAME flattening de Cloudflare.
- **Supabase** ref `yrausytjitthswlwclil`. Site URL de Auth ya apuntada a `https://foguito.com`.
- **PAT de Supabase** usado para DDL en el setup → **REVOCADO** (dashboard → Account → Access
  Tokens). Si una próxima sesión necesita aplicar DDL sin `db push`, hay que mintear uno nuevo y
  volver a revocarlo al terminar. Nunca commitearlo (sólo scratchpad/`.env.local`).

## Vendors — estado (todos PENDIENTES de contratar)

| Vendor | Env | Para | Estado |
|---|---|---|---|
| Didit | `DIDIT_*` + `KYC_PROVIDER=didit` | KYC 18+ creadora | inerte (arrancar con `KYC_PROVIDER=manual`) |
| CSAM (Thorn/PhotoDNA/IWF) + NCMEC | `CSAM_*`, `NCMEC_*` | hash-match pre-publicación | inerte |
| Age-verify | `AGE_VERIFY_*` | age-gate consumidor | inerte |
| NOWPayments + on-ramp | `NOWPAYMENTS_*`, `ONRAMP_*`, `FOGUITOS_PAYMENTS_ENABLED` | money-in MoR | inerte |
| VASP/Payout + Travel-Rule | `PAYOUT_*`, `TRAVEL_RULE_*` | payout regulado | inerte |
| Sanciones (ComplyAdvantage/Chainalysis) | `SANCTIONS_*` | AML 3 superficies | inerte (stub→'review' en prod) |
| Resend | `RESEND_API_KEY` | email transaccional | opcional |
| Upstash | `UPSTASH_*` | rate-limit distribuido | opcional (fallback in-memory) |
| Sentry | `NEXT_PUBLIC_SENTRY_DSN` | observabilidad | opcional |

Al cablear un vendor: cargás su API key (Production+Sensitive), y — si aplica — prendés su flag
(`FOGUITOS_PAYMENTS_ENABLED`, `KYC_PROVIDER=didit`, etc.). El provider real reemplaza al stub solo.

## Gotchas aprendidos (no repetir)

- **`NEXT_PUBLIC_*` se hornea en build** → cambiar el value exige **redeploy**, no basta guardar.
- **`SUPABASE_SERVICE_ROLE_KEY` sólo en Production.** En Preview daría god-mode sobre la DB de prod.
- **Cloudflare nube GRIS** para los CNAME de Vercel (proxied naranja = loop SSL).
- **Turnstile atado al hostname** → login no testeable en previews `*.vercel.app`.
- **Watermark PNG con fondo transparente** (el negro del editor es sólo preview; si se exporta con
  negro, pega un cuadrado negro sobre cada foto). Cuadrado 1:1–3:2, marca blanca + sombra, 100%
  opaca (la opacidad 80-85% la pone Cloudinary al render con `o_80`/`o_85`).
- **`BACKUP_ENCRYPTION_KEY` no se usa en foguito** (feature de velora-plus no portada) — no setear.
- **Commit "Unverified" del stop-hook** = el squash-merge de GitHub (`noreply@github.com`), historia
  ya mergeada → **no reescribir**.
- **DDL vía Management API:** `curl` funciona; `urllib` de Python da 403 (Cloudflare 1010). Para
  validar comportamiento sin ensuciar prod: DO block rollback-wrapped con
  `set_config('request.jwt.claims','{"role":"service_role"}',true)` (para pasar guards) + `RAISE
  EXCEPTION` terminal (surfacea el resultado y hace rollback). Ojo: el trigger `handle_new_user`
  auto-crea el `profiles` al insertar en `auth.users` (no insertar profile a mano en los tests).

## Próximos pasos sugeridos

1. Contratar vendors por orden de necesidad (Didit → CSAM/NCMEC antes de habilitar publicación real;
   NOWPayments/on-ramp para money-in; VASP+Travel-Rule+Sanciones para payout).
2. Hardening manual del preset de Cloudinary (formatos sin SVG, tamaño, moderación).
3. Validación legal/fiscal por mercado (abogado adulto+pagos, contador cross-border) antes de
   habilitar cobros reales.
4. Email: verificar dominio en Resend + DMARC/SPF/DKIM en Cloudflare (patrón en velora-plus
   `docs/security/email-dmarc.md`).
5. **Media → Bunny (plan portado, ADR-0006 + `docs/MIGRACION-MEDIA-BUNNY.md` §5 con la receta real
   de velora):** el **paso 0** (portar el custom loader `image-loader.ts` de velora #441 + guard
   ESLint) es ejecutable YA y cierra la exposición AUP de `/_next/image` de Vercel para el plano
   legacy público, sin esperar a Bunny. El resto (registro `media_assets` → upload fail-closed →
   cutover → cierre) conviene diferirlo hasta que velora complete su PR-C (cutover) y absorber los
   aprendizajes. El contenido PAGO NO se toca (ya está fuera de Cloudinary). ⚠️ al ejecutar:
   `BUNNY_STORAGE_HOST` sin `https://`, backfill con worktree + `tsx --env-file`, refs 404 se
   limpian por SQL antes del cutover, `sharp` a prod deps, archivo de migración con la versión del
   ledger.
