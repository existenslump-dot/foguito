# 0004 — Deploy: apex canónico + Cloudflare DNS-only + Vercel Pro

**Status:** Accepted (2026-07)

## Context

Primer deploy a producción. Había que elegir dominio canónico (apex vs www), cómo apuntar DNS
(Cloudflare, con o sin proxy), y qué plan de Vercel.

## Decision

- **Apex `foguito.com` es el canónico**; `www.foguito.com` hace **308 permanent redirect** al apex.
  Motivo: los defaults del repo (`NEXT_PUBLIC_APP_URL`/`SITE_DOMAIN`) ya son apex, es más limpio de
  marca, y el proyecto hermano (Velora) usa apex canónico.
- **DNS en Cloudflare, records CNAME per-project de Vercel** (apex `@` vía CNAME flattening + `www`),
  ambos en **DNS only (nube gris)** — NO proxied. Con proxy naranja Vercel no puede emitir el cert y
  aparecen loops de SSL/redirect. Vercel maneja SSL/CDN.
- **Vercel plan Pro** — requerido por los 9 crons sub-diarios de `vercel.json` (`*/2`, `*/15`,
  horario). Hobby corre crons 1×/día y con tope de cantidad.

## Consequences

- `NEXT_PUBLIC_APP_URL=https://foguito.com` alimenta CSP `SELF_ORIGIN`, canonicals, sitemap, robots,
  same-origin y callbacks (15+ usos) — cambiar el dominio exige actualizarla + **redeploy** (es
  `NEXT_PUBLIC`, se hornea en build) + actualizar Site URL de Supabase Auth + hostnames de Turnstile.
- Los `NEXT_PUBLIC_*` no pueden ser secretos (van al bundle). Secretos server-side → Production +
  Sensitive; `SUPABASE_SERVICE_ROLE_KEY` **sólo** Production (Preview daría god-mode sobre prod).
- Turnstile atado al hostname → login no testeable en previews `*.vercel.app`.
