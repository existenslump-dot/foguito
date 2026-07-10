# Setup

## 1. Prerequisites
- Node.js 20+
- A Supabase project (free tier is fine)
- A Cloudinary account (free tier is fine)

## 2. Install
```bash
cp .env.example .env.local
npm install
```

## 3. Supabase
1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema: run every file in `supabase/migrations/` **in order**
   (Supabase CLI `supabase db push`, or paste each `.sql` into the SQL editor).
3. Put your project URL, anon key and service-role key into `.env.local`.
4. (Optional) after schema changes, regenerate `src/types/supabase.ts`:
   `SUPABASE_PROJECT_ID=<your-project-ref> npm run types:generate`.

## 4. Cloudinary
1. Create an **unsigned upload preset**.
2. Set `NEXT_PUBLIC_CLOUDINARY_CLOUD` and `NEXT_PUBLIC_CLOUDINARY_PRESET`.
3. (Optional) upload a watermark image and set `NEXT_PUBLIC_CLOUDINARY_WATERMARK_ID`.

## 5. Configure your marketplace
- **Brand, market & features** — `src/config/marketplace.config.ts` (name,
  colors, default country/currency, feature flags), plus the
  `NEXT_PUBLIC_SITE_*` / `MARKET_*` variables in `.env.local`.
- **Categories** — live in the `categories` table (seeded by the init
  migration, editable without redeploying); `src/lib/categories.ts` holds the
  example set and documents how to keep slugs in sync.
- **Listing attributes** — `src/config/attributes.config.ts` is the single
  source of truth. Swap `LISTING_ATTRIBUTES` for your vertical (rates, square
  footage, cuisine, skills…) and the create/edit forms, detail page, feed
  filters and admin field map all follow — no schema migration needed.

## 6. Run
```bash
npm run dev   # http://localhost:3000
npm test      # vitest suite
```

## 7. Make yourself admin
Register through the app (`/registro`), then run in the Supabase SQL editor:
```sql
update profiles set is_admin = true where email = 'you@example.com';
```
`/admin` (moderation, users, analytics) is gated on that flag. On first visit
the panel walks you through enrolling TOTP 2FA.

## 8. Payments (optional add-on)
The payment provider implementations (MercadoPago, NOWPayments) are sold
separately as the **Payments add-on** — see
`packages/payments-kit/PAYMENTS_ADDON.md`. With the add-on installed, set
`FEATURE_PAYMENTS=true`, `NEXT_PUBLIC_PAYMENTS_ENABLED=true`,
`PAYMENT_PROVIDER` and the matching provider keys. Without it, leave the
defaults — the app runs fully with payments off.

## 9. Identity verification (optional)
Set `FEATURE_KYC=true` to enable the built-in verification flow
(`KYC_PROVIDER=manual`): users upload an ID document at `/dashboard/verify`
and admins approve or reject it from `/admin`.

## 10. Deploy
Deploy to Vercel: import the repo, add every variable from `.env.local`, deploy.
Set `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_DOMAIN` to your production domain.
`vercel.json` schedules the maintenance crons (backups, expiring posts,
identity retention) — set `CRON_SECRET` so they can authenticate.

### `NEXT_PUBLIC_APP_URL` and the same-origin guard
Mutating API routes (TOTP setup, sign-out, account deletion, admin actions…)
reject requests whose `Origin` doesn't match a host the deployment recognises
(`403 Invalid origin`). Recognised hosts are, in order:

1. the request's own host (`Host` / `x-forwarded-host`) — so a deployment
   works on whatever domain it's actually served from, with zero config;
2. Vercel's system domains (`VERCEL_URL`, `VERCEL_BRANCH_URL`,
   `VERCEL_PROJECT_PRODUCTION_URL`) — previews and the `*.vercel.app`
   production alias pass out of the box;
3. `NEXT_PUBLIC_APP_URL` — your canonical domain. Keep it current anyway:
   emails, the sitemap, canonical SEO tags and OG links all read it;
4. `APP_URL_ALIASES` — optional comma-separated extra origins. Useful during
   a domain migration while the old domain still redirects traffic; delete it
   once the old domain goes quiet.

A stale `NEXT_PUBLIC_APP_URL` no longer breaks the site (rule 1 covers the
live domain), but links generated in emails/SEO will point at the old domain
until you update it and redeploy.

If `NEXT_PUBLIC_APP_URL` is **unset**, canonical tags, JSON-LD (`@id`/`url`)
and OG links fall back to the placeholder `https://example.com`. Set it (and
redeploy — it's a `NEXT_PUBLIC_*` build-time value) before launch so those
point at your real domain.
