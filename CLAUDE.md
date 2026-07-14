# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev    # Start development server (port 3000)
npm run build  # Production build (the payments-kit workspace resolves from TS source)
npm start      # Run production server
npm run lint   # ESLint check
npm test       # Vitest suite (run mode)
```

## Architecture

**Foguito** is a subscription adult-content platform (OnlyFans-style, con payout a creadoras)
del ecosistema NihilVision. Está **forkeado del engine `marketplace-starter`** (config-driven,
Next.js App Router + Supabase + Tailwind v4). El plan de construcción, la decisión de base y el
roadmap por PRs viven en **`docs/PLAN-DE-TRABAJO.md`** — leelo antes de trabajar. Pilar #0
(bloqueante): sin verificación 18+ / 2257 / CSAM no hay publicación.

> El texto abajo describe el **engine heredado** (listings marketplace). El infra se reusa
> tal cual; el **producto** (creadoras + paywall + entitlements + ledger + payout) está
> **construido encima** (roadmap PR-0→10 COMPLETO). Donde diga "listing/post/city feed", en
> Foguito es contenido de creadora. Branding, mercado y features salen de
> `src/config/marketplace.config.ts` + env.

### Estado del producto — roadmap PR-0→10 COMPLETO (2026-07-13)

Todos los pilares están construidos, con test/gate en verde y validados en la DB viva. Cada
integración externa es **fail-closed**: sin credenciales el feature queda **inerte** (el sitio
levanta igual, el stub jamás clarea en prod). Sistemas construidos sobre el engine:

- **Compliance / publicación (PR-0→4, bloqueante):** no se publica contenido sin performer 18+
  verificado (Didit) + registro 2257 completo + CSAM hash-match pre-publicación (con reporte
  NCMEC); age-gate del consumidor por jurisdicción. Forzado por DB (triggers/RLS), no solo UI.
- **Entrega (PR-5):** contenido con URLs firmadas + watermark (overlay Cloudinary render-time) +
  expiración. La RLS `content_select` gatea `published + csam_status='pass'` ANTES del entitlement.
- **Entitlements + ledger (PR-6):** suscripción/PPV/tips; crédito interno "foguitos" en
  `credit_ledger` doble-entrada inmutable (no redimible, no transferible).
- **Money-in (PR-7):** merchant-of-record, PAN cero (card→USDT on-ramp), webhook firmado (HMAC),
  `purchase_foguitos` RPC atómica idempotente.
- **Payout regulado (PR-8):** revenue-split; ninguna transferencia sin payout-KYC + Travel-Rule +
  sanciones `clear` + registro fiscal. Máquina de estados con claim atómico `sending`.
- **Moderación / takedown (PR-9):** `moderation_events` (cola deny-all, SLA por categoría), intake
  anti-abuso **sin oráculo**, takedown que propaga vía `content.status='removed'`, export a
  autoridad SOLO referencial (nunca bytes/PII), cron de SLA (notifica cada brecha una vez).
- **AML / hardening (PR-10):** screening de sanciones en las **tres** superficies (creadora,
  consumidor, payout) vía `src/lib/aml/screenSubject`; trail append-only `sanctions_screenings`
  (deny-all); gate `held_aml` en money-in; rescreening batch (RPC `stale_consumer_payers`);
  **anti-downgrade** (sólo un vendor real saca de `hit`); scrubbing de PII en Sentry; guard de secretos.

**Infra/deploy vivo + gotchas + estado de vendors → `.claude/HANDOFF.md`.**
**Decisiones arquitectónicas → `docs/adr/`. Bitácora de sesiones → `docs/logbook.md`.**
**Modelo de amenazas + checklist de go-live → `docs/security/threat-model.md`.**



### Routing

- `/` — Gateway: brand landing / city entry
- `/[city]` — City feed: server-rendered list of approved posts (default country slug, e.g. `/argentina`)
- `/[city]/.../post/[id]` — Post detail view (positional geo URL)
- `/ingresar`, `/registro` — Auth pages (Spanish-first; `/login`, `/register` also resolve)
- `/publicar` — Create a listing
- `/planes` — Plans/pricing (payments add-on) · `/pagos` — Checkout (payments add-on)
- `/dashboard` — A user's own listings
- `/dashboard/edit/[id]` — Listing management · `/dashboard/profile` — Profile settings
- `/admin` — Moderation panel (admin-only)

### Auth & Roles

- Supabase handles auth (email/password); sessions persisted via cookies
- Middleware at `src/middleware.ts` refreshes tokens on every request
- User roles: `is_admin` boolean in `profiles` table
- Listing owners create/manage their posts; admins moderate them

### Data Flow

- **Hybrid data access:** most client/server *reads* use the Supabase SDK directly, but
  **mutations, webhooks, cron, payments, KYC, reviews, OG images and push** live in ~50 Next.js
  route handlers under `src/app/api/*` (server-authoritative). Do not assume "no API routes".
- Server components use `createServerClient` with cookie helpers
- Client components initialize Supabase with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Key tables: `profiles` (user data, credits balance), `posts` (content with status workflow)
- Post status workflow: `pending` → `published` or `rejected`; edits go back to `revision` → re-approval

### Media

- Images uploaded via Cloudinary; cloud name and upload preset come from env (`NEXT_PUBLIC_CLOUDINARY_CLOUD`, `NEXT_PUBLIC_CLOUDINARY_PRESET`) — see `src/config/marketplace.config.ts`
- `next.config.ts` allows remote images from `res.cloudinary.com`
- **Migración de media a Bunny planificada — ver `docs/MIGRACION-MEDIA-BUNNY.md` antes de tocar media.** Claves: el contenido PAGO ya está fuera de Cloudinary (bucket privado Supabase + watermark sharp por fan — no lo toca la migración); lo urgente es el plano legacy público, que sigue en Cloudinary **y pasa por el optimizador default de Vercel (`remotePatterns` → `/_next/image`), exposición AUP con media adulta** — el paso 0 del plan (portar el custom loader de velora #441) se puede hacer YA, sin esperar a Bunny. El diseño de referencia y el runbook viven en `velora-plus/docs/media/migracion-cloudinary-bunny.md`

### Styling

- Tailwind CSS v4 via `@tailwindcss/postcss`
- Design language: light/white default with a blue accent (`#2563EB`); dark slate (`#0F172A`) for dark mode
- Design tokens: `marketplace.config.ts` `brand.colors` → `--brand-*` → `--v-*` aliases in `globals.css` that components consume. `layout.tsx` injects a `<style>` block in `<head>` overriding the `globals.css` `--brand-*` defaults (only `--brand-primary`/`-bg` are set at runtime). The accent token is `--v-accent*`. NB: the **"Gold" pricing tier** (`.v-card-tier-gold`, tier slug `'gold'`) is product, unrelated to color — don't conflate when re-theming
- Fonts: Cormorant Garamond (headers), Montserrat (UI labels)
- Dark mode via `.dark` class; default is light theme
- Path alias: `@/*` → `src/*`
- `cn()` utility in `src/lib/utils.ts` for conditional classNames (clsx + tailwind-merge)

### Key Components

- `src/components/UserHeader.tsx` — Sticky nav, auth-aware, role-based menu items
- `src/components/ui/` — Shadcn/UI components (radix-nova style, neutral base color)

> **Nota de marca:** el bloque *Styling* de arriba describe el **default del engine** (azul
> `#2563EB`). La marca real de Foguito es **fuego**: `NEXT_PUBLIC_BRAND_PRIMARY=#FF5330` (ember),
> `_DARK=#17101A` (night), `_LIGHT=#FFF6EF` (cream) — salen de env/config, no del código.

## Deployment & Infra (prod)

- **Host:** Vercel plan **Pro** (necesario por los 9 crons sub-diarios de `vercel.json`).
  Proyecto `foguito`, team `velora-es` (`team_5XVPhfDpQfLxmvcWhEew76xi`). Build = `next build`
  (el workspace `payments-kit` resuelve del source TS; no hay paso `build:kit` separado en Vercel).
- **Dominio:** `foguito.com` (apex) es el **canónico**; `www.foguito.com` **308 → apex**. DNS en
  **Cloudflare**, records **CNAME per-project de Vercel** (apex `@` vía CNAME flattening + `www`),
  ambos en **DNS only (nube GRIS)** — NUNCA proxied (naranja) o rompe el SSL de Vercel. El cert lo
  emite Vercel. `foguito.vercel.app` queda vivo en paralelo.
- **Supabase:** proyecto ref `yrausytjitthswlwclil`. DDL se aplica **manual** (`db push` o
  Management API con PAT temporal — el PAT se **revoca** al terminar); no hay CI de migraciones.
  Tras cablear el dominio: **Auth → URL Configuration → Site URL = `https://foguito.com`** +
  Redirect URLs `https://foguito.com/**` (o los emails de confirmación/reset apuntan mal).
- **Matriz de env vars:** los `NEXT_PUBLIC_*` van a **Prod+Preview+Dev**, **no** son secretos (se
  hornean en el bundle → cambiarlos exige **redeploy**). Los secretos server-side
  (`SUPABASE_SERVICE_ROLE_KEY`, `*_SECRET`, `*_API_KEY`, `TURNSTILE_SECRET`, `CRON_SECRET`,
  `CLOUDINARY_API_SECRET`, `ADMIN_SECRET`, `LEDGER_IDEMPOTENCY_SALT`) van **Production + Sensitive**.
  ⚠️ `SUPABASE_SERVICE_ROLE_KEY` va **SOLO en Production** (en Preview daría god-mode sobre la DB de
  prod). `NEXT_PUBLIC_APP_URL`/`SITE_DOMAIN` = `foguito.com` (alimentan CSP `SELF_ORIGIN`,
  canonicals, sitemap, robots, same-origin, callbacks de pago/KYC — 15+ usos).
- **Auth captcha:** Cloudflare **Turnstile**, atado al hostname de prod → el login **no se testea en
  previews `*.vercel.app`** (verificar en prod, o local con `localhost` en el widget). Las test-keys
  de Cloudflare (`1x0000…`) siempre pasan, sólo para smoke-test, NUNCA en prod real.
- **Media:** Cloudinary cloud `y9ldddnr`, preset **unsigned** para el alta; el contenido pagado va por
  URLs firmadas server-side (usa `CLOUDINARY_API_SECRET`), no por el preset. Hardening del preset
  (formatos sin SVG, tamaño) = acción manual de consola. Watermark = PNG **transparente** (no negro),
  public_id en `NEXT_PUBLIC_CLOUDINARY_WATERMARK_ID` (formato `carpeta:public_id` si va en carpeta).
- **Secretos AES-256** (`DIDIT_PAYLOAD_KEY`): 32 bytes en hex (64 chars) →
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (equivale a
  `openssl rand -hex 32`; el código acepta hex-64 o base64, valida 32 bytes). ⚠️
  `BACKUP_ENCRYPTION_KEY` **NO se consume** en foguito (la réplica off-site cifrada es de
  velora-plus, no portada) → no lo generes ni lo setees.
- **Git:** el commit de squash-merge lo crea **GitHub** con committer `noreply@github.com` → el
  stop-hook lo marca "Unverified", pero es **esperado** y **no se reescribe** (es historia ya
  mergeada en `main`). Los commits propios usan `Claude <noreply@anthropic.com>`.
