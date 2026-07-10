# Migrations

The database schema ships as a **single consolidated init migration**:
`supabase/migrations/20260101000000_init.sql`. Run on a fresh database it
produces the final schema directly (generic `posts.attributes` JSONB, the
local-services category seed, generic `reports.category` values, the
`payment_transactions` table + `apply_payment_activation()`, and the
identity-retention columns on `deletion_log`). It is idempotent
(`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` → `CREATE POLICY`, etc.).

## Fresh deploys

```bash
supabase db push
```

Nothing else is required — the single init builds everything in dependency order.

## Existing / already-migrated databases

An already-deployed database (e.g. the original production instance) is already
at this exact final state. It previously applied these now-removed migrations,
which have been **folded into the init**:

- `20260612000000_identity_retention`
- `20260612001000_payment_activation`
- `20260615000000_generic_listing_model`
- `20260616000000_generic_report_categories`
- `20260616010000_local_services_categories`

Because those version numbers are gone from `supabase/migrations/`, the remote
migration history and the local files no longer line up. Do **not** re-run the
init against such a database. Instead reconcile the recorded history with
`supabase migration repair`:

```bash
# mark the removed (folded-in) versions as reverted in the remote history
supabase migration repair --status reverted 20260612000000
supabase migration repair --status reverted 20260612001000
supabase migration repair --status reverted 20260615000000
supabase migration repair --status reverted 20260616000000
supabase migration repair --status reverted 20260616010000

# and ensure the consolidated init is recorded as applied
supabase migration repair --status applied 20260101000000
```

After repair, `supabase migration list` should show the single init as applied
and no pending changes. The live schema is unchanged by this — it is purely a
history-bookkeeping reconciliation.

## Follow-up migrations (init drifted behind the app code)

`20260101000000_init.sql` turned out to be **incomplete relative to the
application code** — multiple columns/tables the code reads/writes were never in
it, which 500'd / errored the admin panel and the signup flow on the demo DB.
These additive, idempotent migrations patch it (a fresh `supabase db push` runs
them after init):

- **`20260626120000_fix_profiles_policy_recursion`** — `public.is_admin()`
  `SECURITY DEFINER` helper; rewrites `profiles_select_own/update_own` to use it
  (the old self-referencing sub-SELECT caused "infinite recursion … relation
  profiles", which broke admin checks app-wide).
- **`20260626130000_align_admin_schema`** — `reports.status`; the `recordAudit()`
  columns on `audit_log` (`event_type/actor_role/actor_user_id/subject_*/ip/
  user_agent`, alongside the legacy `logAudit()` `action/resource`); the
  `tier_settings` table (public read / admin write, seeded Gold+Basic); re-seeds
  the `tiers` catalogue.
- **`20260626140000_fix_reports_action_columns`** — corrects the `reports.status`
  CHECK to `('pending','actioned','dismissed')` (the code writes **`actioned`**,
  not `resolved`) and adds `actioned_by_admin_id/actioned_at/admin_note`.
- **`20260626150000_align_profiles_signup_compliance_totp`** — the missing
  `profiles` consent/TOTP columns (`terms_accepted_at`, `terms_accepted_ip`,
  `kyc_submitted_ip`, `totp_secret`, `totp_enabled`, `totp_recovery_codes`,
  `last_totp_verified_at`).

**TODO:** fold these back into `init.sql` so fresh deploys get the correct schema
in a single file, then update the repair list above.

## Feature migrations

Additive, idempotent migrations that extend the schema for optional features:

- **`20260705130000_user_subscriptions`** — subscriptions with a real duration:
  the `user_subscriptions` table (one row per payment activation; users read
  their own rows, admins read all, only the service role writes), a
  `duration_days` column on `elite_subscriptions`, and
  `apply_payment_activation()` extended with `p_duration_days` + `p_tier` so a
  purchase stamps `expires_at = now() + duration` instead of assuming 30 days.
  Note it **drops the previous 8-argument signature first** — in Postgres,
  re-creating a function with extra defaulted parameters would otherwise leave
  both overloads behind and make calls ambiguous.
- **`20260706120000_boost_purchases`** — credit-paid feed boosts: the
  `boost_purchases` table (one row per purchase, `idempotency_key` UNIQUE as
  the replay anchor; users read their own rows, admins all, service role
  writes), the atomic `purchase_post_boost()` RPC (owner + published checks,
  balance-guarded debit, extends `boost_ends_at` when already active, ledger
  entry), and the `posts_guard_paid_flags` trigger that makes
  `is_boosted`/`boost_ends_at`/`is_pinned`/`pin_ends_at` **server-managed** —
  without it, the owner-update RLS policy would let any owner flip their own
  boost flag for free from the client SDK.
- **`20260707120000_self_serve_renewal`** — self-serve renewals:
  `apply_payment_activation()` gains `p_renew_post_id` (drops the 10-arg
  signature first — same overload caveat as above). When a payment carries a
  renewal target owned by the credited user, activation extends the post's
  `expires_at` by the package duration inside the same atomic claim (replays
  can't double-extend) and resets the `notified_5d`/`notified_1d` reminder
  flags. Also adds `elite_subscriptions.renew_post_id` for the Elite flow.
  The target travels in the pending row's metadata (`mp_payments` /
  `payment_transactions`), never in gateway payloads.
- **`20260707130000_expiry_audit_cleanup`** — drops the dead
  `posts.notified_7d`/`notified_15d` columns (the reminder cron runs on the
  5d/1d intervals; nothing ever read the 7d/15d pair), adds
  `posts.expiry_audited` (cron bookkeeping: one `post_expired` audit_log
  event per crossed expiry, with a partial index for the daily scan), and
  the `posts_rearm_expiry_audit` trigger that resets the flag whenever
  `expires_at` is extended into the future — renewals and unpauses re-arm
  the next expiry audit automatically.

## Demo seed data (demo project)

These seed the **demo content** (not schema). They are additive + idempotent. A fresh `supabase db push`
runs them after init, populating a realistic catalogue out of the box.

- **`20260626160000_seed_demo_posts`** — **18 listings, 3 per category** (belleza-bienestar,
  clases-particulares, eventos-fotografía, hogar-reparaciones, tecnología, salud) with coherent
  title/description/`attributes` and **service-matched Unsplash images** (replacing the earlier
  incoherent Cloudinary `demo`-cloud samples), a few `is_promoted`. Resolves the country by slug
  (`WHERE slug='argentina'`); fixed `id`s with `ON CONFLICT (id) DO UPDATE` (re-runnable, also
  corrects the original 6 rows).
- **`20260627010000_seed_demo_profile_photos`** — a **portrait headshot** per listing as
  `profile_photo_url`, appended to `image_urls` (so `PostDetailView` uses it as the avatar while
  `image_urls[0]` stays the feed cover). Idempotent (appends only if absent). Pairs with the
  `fit=facearea` crop in `getProfileCircleUrl`.

Note: images are served from `images.unsplash.com` (whitelisted in `next.config.ts`); a deployment
that wants its own media should re-seed with its Cloudinary URLs.
