# Logbook — Foguito

Bitácora cronológica de sesiones. Lo más nuevo arriba. Detalle arquitectónico en `docs/adr/`,
estado operativo en `.claude/HANDOFF.md`.

---

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
