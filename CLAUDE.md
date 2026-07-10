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
> tal cual; el **producto** (creadoras + paywall + entitlements + ledger + payout) se construye
> encima en los PRs 5–8. Donde diga "listing/post/city feed", en Foguito es contenido de creadora.
> Branding, mercado y features salen de `src/config/marketplace.config.ts` + env.



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
