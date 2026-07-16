# Logbook — Foguito

Bitácora cronológica de sesiones. Lo más nuevo arriba. Detalle arquitectónico en `docs/adr/`,
estado operativo en `.claude/HANDOFF.md`.

---

## 2026-07-16 — Plan de migración de media Cloudinary → Bunny (porteo desde velora)

- **Contexto:** velora ejecutó la migración de media a Bunny de punta a punta (infra viva, 166
  assets migrados y verificados, PR-A fundaciones + PR-B upload mergeados). Se portó el **plan +
  aprendizajes reales** a foguito para replicarlo casi mecánicamente.
- **Docs nuevos/actualizados:**
  - `docs/MIGRACION-MEDIA-BUNNY.md` → **§5 "Aprendizajes de la ejecución REAL en velora"**:
    receta de consola Bunny, gotchas de env (`BUNNY_STORAGE_HOST` sin `https://`, tres keys
    distintas, sacar `NODE_TLS_REJECT_UNAUTHORIZED=0`, nunca keys en el chat), backfill con
    worktree + `tsx --env-file` (no dotenv-cli), manejo de refs muertas (404) por SQL, checklist
    de verificación en vivo, migración por MCP con versión del ledger, y PR-B prod-safe (sharp a
    prod deps, alias `server-only` en vitest, watermark en runtime de Vercel).
  - `docs/adr/0006-media-storage-migration-cloudinary-bunny.md` (nuevo) — decisión de porteo con
    los deltas de foguito (dos planos, token off/on, CSAM gate primero, TUS de Stream).
- **Decisión de secuencia:** **paso 0 (portar el custom loader de velora #441) es ejecutable YA**
  — cierra la exposición AUP de `/_next/image` de Vercel sin esperar a Bunny. El resto (PR-A→cierre)
  conviene diferirlo hasta que velora complete su **PR-C (cutover)** y absorber los aprendizajes.
- **Recordatorio:** el contenido PAGO ya está fuera de Cloudinary (bucket Supabase + watermark
  sharp por fan) — la migración solo cubre el plano legacy público.

## 2026-07-13 — Deploy a producción + cierre de docs

- **Deploy inicial a Vercel (Pro)** con lo mínimo funcional: Supabase + dominio + SSL + Turnstile +
  Cloudinary.
- **Dominio `foguito.com`** conectado: apex canónico, `www` 308→apex, Cloudflare DNS con CNAME
  per-project de Vercel en **nube gris** (DNS only). SSL emitido por Vercel. Ver ADR-0004.
- **Cloudinary** configurado (cloud `y9ldddnr`, preset unsigned). Watermark diseñado (PNG
  transparente 1:1, gota-llama blanca + ember `#FF5330`).
- **Turnstile** (captcha login) atado al hostname de prod.
- **Supabase Auth Site URL** apuntada a `https://foguito.com`.
- **PAT de Supabase** (usado para DDL en las sesiones de build) **REVOCADO**.
- **Docs actualizados:** CLAUDE.md (estado del producto + deployment), `.claude/HANDOFF.md` (nuevo),
  `docs/adr/` (0001–0005, nuevo), este logbook, `docs/PLAN-DE-TRABAJO.md` (roadmap COMPLETO).
- Aprendizajes clave → `.claude/HANDOFF.md` § Gotchas.

## 2026-07-12/13 — Roadmap de construcción PR-0 → PR-10 (COMPLETO)

Construcción del producto sobre el engine `marketplace-starter`, config-driven, compliance-first.
Cada PR: revisión adversarial (Opus, cero críticos/altos), gate completo, y validación
rollback-wrapped en la DB viva para los que tocan schema.

- **PR-0→4** — Fundaciones + compliance de publicación: KYC 18+ (Didit), 2257, detección CSAM
  (hash-match pre-publicación + reporte NCMEC), age-gate del consumidor por jurisdicción. Pilar
  bloqueante: sin verificación no hay publicación (forzado por DB).
- **PR-5** (#…) — Entrega de contenido: URLs firmadas + watermark render-time + expiración.
- **PR-6** (#9) — Entitlements (suscripción/PPV/tips) + ledger `foguitos` doble-entrada.
- **PR-7** (#10) — Money-in: merchant-of-record, PAN cero, webhook firmado. Ver ADR-0005.
- **PR-8** (#11) — Payout regulado: revenue-split + VASP/Travel-Rule/sanciones + fiscal; claim
  atómico `sending` contra doble-transferencia.
- **PR-9** (#12) — Quejas/takedown/cooperación con autoridades. Ver ADR-0003. Fixes post-adversarial:
  dedup/rate-limit por identidad + cap global-por-pieza, 200 genérica en fallo de insert (sin
  oráculo), guard de `CRON_SECRET` sin setear, notify-once del SLA, TOTP fail-closed.
- **PR-10** (#13) — AML 3 superficies + hardening. Ver ADR-0002. Fixes post-adversarial:
  anti-downgrade del flag AML, RPC `stale_consumer_payers` (evita truncar el rescreening), scrubber
  de Sentry extendido, tripwire del guard de secretos.

Patrón transversal: **provider fail-closed + stub verificable** (ADR-0001) — todo vendor externo
queda inerte sin credenciales, sin abrir agujeros.
