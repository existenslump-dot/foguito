-- Initial schema for a fresh database (dependency-ordered).

-- ===== 001_extensions =====

-- ══════════════════════════════════════════════════════════════════════════
-- 001 — Extensions and global helpers.
-- ══════════════════════════════════════════════════════════════════════════

-- pgcrypto: gen_random_uuid() for PKs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- unaccent: geo backfill helper — normalize free text (`localidad`) against
-- comuna/barrio names regardless of accents. Kept in case additional
-- backfills need to run from admin.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- pg_cron: internal scheduler for recurring jobs (see 008_cron_jobs.sql).
-- On Supabase it's preinstalled but needs CREATE EXTENSION to expose the
-- `cron` schema.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── Helper: normalize free-text for fuzzy matching ────────────────────────
-- Trim + lowercase + strip accents. Used by backfills and possible
-- server-side searches where the client can't do the normalization (RPC).
CREATE OR REPLACE FUNCTION geo_norm(s TEXT) RETURNS TEXT AS $$
  SELECT LOWER(unaccent(COALESCE(s, '')))
$$ LANGUAGE SQL IMMUTABLE;

-- ── Helper: touch updated_at ──────────────────────────────────────────────
-- Generic trigger used by elite_subscriptions (and, in the future, any
-- table that wants to maintain updated_at without the client setting it).
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===== 003_geo_hierarchy =====

-- ══════════════════════════════════════════════════════════════════════════
-- 003 — Geo hierarchy: country → provincia → comuna → barrio.
--
-- URL: /{country}/{provincia?}/{comuna?}/{barrio?}  (2-4 variable segments)
-- posts carries 4 nullable FKs (country required after backfill) — the
-- deepest non-null level defines the canonical location.
--
-- The (Spanish) naming maps cleanly to Chile (comuna = basic admin division)
-- and Brazil (via per-country UI labels). Tables + full Argentina seed.
--
-- Argentina data source: cuidades.txt (strict positional mapping).
-- Final structure:
--   3 countries        (AR active + CL/BR prepared)
--   24 AR provincias   (CABA + Buenos Aires + 22 direct provinces)
--   56 AR comunas      (47 CABA + 9 BsAs)
--   49 AR barrios      (25 North Zone + 13 West Zone + 11 South Zone)
-- ══════════════════════════════════════════════════════════════════════════


-- ── Tables (topological order) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS countries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  code       CHAR(2) NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provincias (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (country_id, slug)
);

CREATE TABLE IF NOT EXISTS comunas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provincia_id UUID NOT NULL REFERENCES provincias(id) ON DELETE RESTRICT,
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provincia_id, slug)
);

CREATE TABLE IF NOT EXISTS barrios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comuna_id  UUID NOT NULL REFERENCES comunas(id) ON DELETE RESTRICT,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (comuna_id, slug)
);

-- Indexes for URL resolution (UNIQUE already covers parent+slug; these help
-- "list children of X" in admin and dropdowns):
CREATE INDEX IF NOT EXISTS idx_provincias_country ON provincias (country_id);
CREATE INDEX IF NOT EXISTS idx_comunas_provincia  ON comunas (provincia_id);
CREATE INDEX IF NOT EXISTS idx_barrios_comuna     ON barrios (comuna_id);


-- ── Seed ──────────────────────────────────────────────────────────────────

-- Countries
-- ===== 002_core_tables =====

-- ══════════════════════════════════════════════════════════════════════════
-- 002 — Core tables.
--
-- Each CREATE TABLE reflects the FINAL schema (all historical ALTERs
-- collapsed). Topological order: profiles → posts → favorites/reports →
-- categories/tiers → misc.
--
-- RLS enable + policies are set up in 007_rls_policies.sql.
-- Indexes in 006_indexes.sql.
-- ══════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────
-- profiles — extension of auth.users with business metadata
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id                       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                    TEXT,
  full_name                TEXT,
  phone                    TEXT,
  avatar_url               TEXT,
  profile_slug             TEXT UNIQUE,
  profile_bio              TEXT,
  profile_public           BOOLEAN NOT NULL DEFAULT false,

  -- Roles / flags
  is_admin                 BOOLEAN NOT NULL DEFAULT false,
  is_flagged               BOOLEAN NOT NULL DEFAULT false,

  -- Credits
  credits                  INT NOT NULL DEFAULT 0,
  credits_purchased_at     TIMESTAMPTZ,
  credits_expiry_notified  BOOLEAN NOT NULL DEFAULT false,
  welcome_credit_assigned  BOOLEAN NOT NULL DEFAULT false,
  welcome_credit_expires_at TIMESTAMPTZ,

  -- Identity verification
  verification_status      TEXT,        -- pending / approved / rejected
  identity_verified        BOOLEAN NOT NULL DEFAULT false,
  identity_doc_url         TEXT,
  identity_selfie_url      TEXT,
  identity_video_url       TEXT,

  -- Audit / anti-abuse
  registration_ip          TEXT,
  privacy_accepted_at      TIMESTAMPTZ,
  last_nudge_at            TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ──────────────────────────────────────────────────────────────────────────
-- tiers — catalog (elite/gold/silver/bronze/basic)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tiers (
  id          TEXT PRIMARY KEY,                 -- 'basic' / 'bronze' / 'silver' / 'gold' / 'elite'
  name        TEXT NOT NULL,
  credits     INT NOT NULL,                     -- cost in credits to publish
  photos      INT NOT NULL DEFAULT 6,
  videos      INT NOT NULL DEFAULT 0,
  sort_order  INT NOT NULL DEFAULT 0
);

INSERT INTO tiers (id, name, credits, photos, videos, sort_order) VALUES
  ('basic', 'Basic', 49,  6,  0, 1),
  ('bronze',   'Bronze',   99,  9,  3, 2),
  ('silver',   'Silver',   199, 12, 6, 3),
  ('gold',   'Gold',   399, 20, 12, 4),
  ('elite',    'Elite',    599, 30, 20, 5)
ON CONFLICT (id) DO NOTHING;


-- ──────────────────────────────────────────────────────────────────────────
-- categories — dynamic catalog
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: a concrete vertical example — local services / professional
-- directory. Change these slugs/labels to retarget the marketplace.
INSERT INTO categories (slug, name, sort_order) VALUES
  ('hogar-reparaciones', 'Hogar y Reparaciones',  1),
  ('clases-particulares', 'Clases Particulares',   2),
  ('belleza-bienestar',  'Belleza y Bienestar',    3),
  ('eventos-fotografia', 'Eventos y Fotografía',   4),
  ('tecnologia',         'Tecnología y Soporte',   5),
  ('salud',              'Salud y Cuidados',       6)
ON CONFLICT (slug) DO NOTHING;


-- ──────────────────────────────────────────────────────────────────────────
-- city_category_settings — per-country category visibility
-- (historical "city" name kept; slugs are country_slug now)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS city_category_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_slug      TEXT NOT NULL,   -- country slug (argentina/chile/brasil)
  category_slug  TEXT NOT NULL,
  visible        BOOLEAN NOT NULL DEFAULT true,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city_slug, category_slug)
);


-- ──────────────────────────────────────────────────────────────────────────
-- posts — main table (listings)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Identity
  title              TEXT NOT NULL,
  description        TEXT,
  post_slug          TEXT,

  -- Classification
  category           TEXT,
  tier               TEXT CHECK (tier IN ('basic', 'bronze', 'silver', 'gold', 'elite')),
  tier_id            TEXT REFERENCES tiers(id),

  -- Price
  price              INT,
  currency           TEXT,
  price_usd          INT,
  price_eur          INT,

  -- Geo: country → provincia → comuna → barrio hierarchy (FKs to 003_geo_hierarchy.sql)
  country_id         UUID REFERENCES countries(id),
  provincia_id       UUID REFERENCES provincias(id),
  comuna_id          UUID REFERENCES comunas(id),
  barrio_id          UUID REFERENCES barrios(id),
  localidad          TEXT,       -- historical free text (concatenated display name)

  -- Contact
  whatsapp_number    TEXT,
  telegram_number    TEXT,

  -- Media
  image_urls         TEXT[],
  video_urls         TEXT[],
  audio_url          TEXT,
  audio_filename     TEXT,
  cover_video_url    TEXT,
  profile_photo_url  TEXT,

  -- Status / moderation
  status             TEXT CHECK (status IN ('pending','published','rejected','revision','draft')) DEFAULT 'pending',
  is_approved        BOOLEAN,
  is_hidden          BOOLEAN NOT NULL DEFAULT false,
  is_paused          BOOLEAN NOT NULL DEFAULT false,
  paused_at          TIMESTAMPTZ,
  rejection_reason   TEXT,
  parent_post_id     UUID REFERENCES posts(id) ON DELETE SET NULL,
  approved_at        TIMESTAMPTZ,
  published_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,

  -- Trial / promotion
  is_free_trial      BOOLEAN NOT NULL DEFAULT false,
  is_promoted        BOOLEAN NOT NULL DEFAULT false,
  promo_price        INT,
  promo_ends_at      TIMESTAMPTZ,
  is_pinned          BOOLEAN NOT NULL DEFAULT false,
  pin_ends_at        TIMESTAMPTZ,
  is_boosted         BOOLEAN NOT NULL DEFAULT false,
  boost_ends_at      TIMESTAMPTZ,

  -- Realtime / engagement
  is_online          BOOLEAN NOT NULL DEFAULT false,
  favorites_count    INT NOT NULL DEFAULT 0,

  -- Generic listing attributes (config-driven; see
  -- src/config/attributes.config.ts → LISTING_ATTRIBUTES). Replaces the
  -- previous vertical's typed columns with a single JSONB blob, so changing
  -- vertical doesn't require a schema migration.
  attributes         JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Verification
  identity_verified  BOOLEAN NOT NULL DEFAULT false,
  verification_status TEXT,
  id_document_url    TEXT,

  -- Notifications (expiry) — live cron intervals: 5d and 1d.
  notified_1d        BOOLEAN NOT NULL DEFAULT false,
  notified_5d        BOOLEAN NOT NULL DEFAULT false,
  -- Expiry-audit bookkeeping (post_expired event, once per expiry; re-armed
  -- when expires_at is extended — see the expiry_audit_cleanup migration).
  expiry_audited     BOOLEAN NOT NULL DEFAULT false,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);




-- ──────────────────────────────────────────────────────────────────────────
-- favorites — users mark posts as favorites
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id    TEXT NOT NULL,     -- text (historical — some posts use slug)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, post_id)
);




-- ──────────────────────────────────────────────────────────────────────────
-- reports — inappropriate-content flags
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id        UUID REFERENCES posts(id) ON DELETE CASCADE,
  category       TEXT NOT NULL CHECK (category IN ('spam','estafa','contenido_inapropiado','contenido_prohibido','otro')),
  description    TEXT,
  reporter_ip    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);




-- ──────────────────────────────────────────────────────────────────────────
-- Auxiliary tables (admin / anti-abuse / logs)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,
  action      TEXT NOT NULL,
  resource    TEXT,
  ip_address  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- deletion_log: audit trail of deletions + identity-purge scheduling.
-- Identity documents (ID/passport, selfie, video) live in the private
-- `identity-documents` bucket under `{userId}/...`. The privacy policy
-- promises retention of at most 1 year after account closure:
--   identity_purge_after — when the folder becomes eligible for purge
--                          (deleted_at + IDENTITY_RETENTION_DAYS).
--   identity_purged_at   — stamped once the folder has been deleted.
-- The account-deletion route writes identity_purge_after; the
-- /api/cron/identity-retention job looks for due rows with identity_purged_at NULL.
CREATE TABLE IF NOT EXISTS deletion_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id   TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  deleted_by    UUID,
  reason        TEXT,
  payload       JSONB,
  user_id              UUID,
  email_hash           TEXT,
  deleted_at           TIMESTAMPTZ,
  identity_purge_after TIMESTAMPTZ,
  identity_purged_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Purge cron scans for due, not-yet-purged rows. Partial index keeps it small.
CREATE INDEX IF NOT EXISTS idx_deletion_log_identity_pending
  ON deletion_log (identity_purge_after)
  WHERE identity_purge_after IS NOT NULL AND identity_purged_at IS NULL;

CREATE TABLE IF NOT EXISTS rate_limits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip          TEXT,
  route       TEXT NOT NULL,
  count       INT NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ip, route, window_start)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  keys       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE TABLE IF NOT EXISTS support_chats (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  sender     TEXT NOT NULL CHECK (sender IN ('user', 'admin')),
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ──────────────────────────────────────────────────────────────────────────
-- Signup trigger: auto-creates a profile on registration in auth.users
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, avatar_url, credits,
    welcome_credit_assigned, welcome_credit_expires_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url',
    100,
    true,
    NOW() + INTERVAL '7 days'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ===== 004_payments =====

-- ══════════════════════════════════════════════════════════════════════════
-- 004 — Payments: MercadoPago, NOWPayments (Elite), credits, exchange rates.
--
-- All RLS enabled (see 007). Writes via service-role from webhooks/routes;
-- reads filtered by `user_id = auth.uid()` on clients.
-- ══════════════════════════════════════════════════════════════════════════


-- ── MercadoPago payments ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mp_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID,  -- nullable (concierge mode allows an anon payer)
  package_id       TEXT NOT NULL,
  credits          INT NOT NULL,
  amount_usd       NUMERIC(10,2),
  amount_ars       NUMERIC(12,2) NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'ARS',
  status           TEXT NOT NULL DEFAULT 'pending', -- pending / approved / rejected / refunded
  mp_payment_id    TEXT,
  mp_preference_id TEXT,
  payer_email      TEXT,
  label            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mp_payments_user_id    ON mp_payments (user_id);
CREATE INDEX IF NOT EXISTS idx_mp_payments_mp_payment ON mp_payments (mp_payment_id);
CREATE INDEX IF NOT EXISTS idx_mp_payments_status     ON mp_payments (status);


-- ── Unified gateway transactions (all providers) ──────────────────────────
-- One row per gateway payment, with UNIQUE (gateway, gateway_tx_id) as the
-- idempotency anchor. Replaces the hand-rolled read-modify-writes with the
-- atomic apply_payment_activation() primitive (defined further below).
CREATE TABLE IF NOT EXISTS payment_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway        TEXT NOT NULL,            -- 'mercadopago' / 'nowpayments'
  gateway_tx_id  TEXT NOT NULL,            -- provider-side payment id
  order_ref      TEXT,                     -- our opaque order reference (non-enumerable)
  user_id        UUID,                     -- null = anonymous payer (concierge fallback)
  package_id     TEXT NOT NULL,
  credits        INT  NOT NULL DEFAULT 0,
  amount_usd     NUMERIC(10,2),
  pay_currency   TEXT,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending / completed / failed / expired / partially_paid
  payer_email    TEXT,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  UNIQUE (gateway, gateway_tx_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_tx_user_id   ON payment_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_status    ON payment_transactions (status);
CREATE INDEX IF NOT EXISTS idx_payment_tx_order_ref ON payment_transactions (order_ref);


-- ── Credit ledger (audit trail of grants/debits) ──────────────────────────
CREATE TABLE IF NOT EXISTS credit_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  amount      INT NOT NULL,  -- positive = credit, negative = debit
  reason      TEXT NOT NULL, -- 'mp_payment' / 'welcome_credit' / 'post_published' / etc
  reference   TEXT,          -- e.g. mp_payment_id, post_id
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_tx_user_id ON credit_transactions (user_id);


-- ── Elite subscriptions (NOWPayments crypto; 599 USD/mo) ───────────────────
CREATE TABLE IF NOT EXISTS elite_subscriptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID,
  email              TEXT NOT NULL,
  comprobante_email  TEXT,
  order_id           TEXT UNIQUE NOT NULL,
  np_payment_id      TEXT,
  pay_address        TEXT,
  pay_amount         NUMERIC(20,8),
  pay_currency       TEXT,
  status             TEXT NOT NULL DEFAULT 'pending', -- pending / active / expired / failed
  expires_at         TIMESTAMPTZ,
  notes              TEXT,
  paid_at            TIMESTAMPTZ,        -- stamped by the activation route
  amount_usd         NUMERIC(10,2),      -- stamped by the activation route
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_elite_subs_user_id  ON elite_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_elite_subs_email    ON elite_subscriptions (email);
CREATE INDEX IF NOT EXISTS idx_elite_subs_status   ON elite_subscriptions (status);

-- updated_at trigger (function in 001_extensions.sql).
DROP TRIGGER IF EXISTS elite_subs_updated_at ON elite_subscriptions;
CREATE TRIGGER elite_subs_updated_at
  BEFORE UPDATE ON elite_subscriptions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ── Exchange rates (cached FX for international payments) ──────────────────
CREATE TABLE IF NOT EXISTS exchange_rates (
  id          SERIAL PRIMARY KEY,
  base        CHAR(3) NOT NULL DEFAULT 'USD',
  target      CHAR(3) NOT NULL,
  rate        NUMERIC(14,6) NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (base, target)
);

-- Seed: placeholders; the /api/exchange-rates cron/API updates with real rates.
INSERT INTO exchange_rates (base, target, rate) VALUES
  ('USD', 'ARS', 0),
  ('USD', 'EUR', 0),
  ('USD', 'BRL', 0),
  ('USD', 'CLP', 0)
ON CONFLICT (base, target) DO NOTHING;


-- ── Atomic payment-activation primitive ───────────────────────────────────
-- Claims the (gateway, gateway_tx_id) transaction exactly once and applies
-- the credit grant. Concurrency-safe:
--   • fresh tx (MP flow: no pending row pre-exists)  → INSERT completes it
--   • pending tx (NP flow: created at checkout time) → conflict-UPDATE claims
--     it only while status = 'pending'; a second replay matches 0 rows
--   • anything already terminal                       → 'already-applied'
-- Returns: 'applied' | 'already-applied' | 'no-user'
--   'no-user' = payment recorded as completed but no account to credit
--   (anonymous payer) — caller falls back to manual/admin fulfilment.
CREATE OR REPLACE FUNCTION apply_payment_activation(
  p_gateway       TEXT,
  p_gateway_tx_id TEXT,
  p_user_id       UUID,
  p_package_id    TEXT,
  p_credits       INT,
  p_amount_usd    NUMERIC,
  p_payer_email   TEXT,
  p_order_ref     TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_credits INT;
BEGIN
  INSERT INTO payment_transactions AS pt
    (gateway, gateway_tx_id, order_ref, user_id, package_id, credits,
     amount_usd, payer_email, status, completed_at)
  VALUES
    (p_gateway, p_gateway_tx_id, p_order_ref, p_user_id, p_package_id,
     COALESCE(p_credits, 0), p_amount_usd, p_payer_email, 'completed', now())
  ON CONFLICT (gateway, gateway_tx_id) DO UPDATE
    SET status       = 'completed',
        completed_at = now(),
        user_id      = COALESCE(pt.user_id, EXCLUDED.user_id),
        payer_email  = COALESCE(pt.payer_email, EXCLUDED.payer_email)
    WHERE pt.status = 'pending'
  RETURNING pt.user_id, pt.credits INTO v_user_id, v_credits;

  -- Conflict row already terminal → the WHERE filtered it out, nothing
  -- returned. This is the replay path: never credit twice.
  IF NOT FOUND THEN
    RETURN 'already-applied';
  END IF;

  IF v_user_id IS NULL THEN
    RETURN 'no-user';
  END IF;

  UPDATE profiles
     SET credits = credits + COALESCE(v_credits, 0),
         credits_purchased_at = now()
   WHERE id = v_user_id;

  -- Profile deleted between payment and webhook — keep the tx completed
  -- (money WAS received) but flag that nobody got credited.
  IF NOT FOUND THEN
    RETURN 'no-user';
  END IF;

  INSERT INTO credit_transactions (user_id, amount, reason, reference)
  VALUES (v_user_id, COALESCE(v_credits, 0), 'payment_' || p_gateway, p_gateway_tx_id);

  RETURN 'applied';
END;
$$;

-- Webhooks run with the service role; nothing client-side may call this.
REVOKE ALL ON FUNCTION apply_payment_activation(TEXT, TEXT, UUID, TEXT, INT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_payment_activation(TEXT, TEXT, UUID, TEXT, INT, NUMERIC, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_payment_activation(TEXT, TEXT, UUID, TEXT, INT, NUMERIC, TEXT, TEXT) TO service_role;

-- ===== 005_analytics =====

-- ══════════════════════════════════════════════════════════════════════════
-- 005 — Analytics events (view / whatsapp_click / favorite / photo_view).
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  photo_index INT,
  user_id     UUID,
  city        TEXT,        -- legacy; see 006 for the new approach via posts FK
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for the internal dashboards (admin/dashboard analytics).
CREATE INDEX IF NOT EXISTS idx_analytics_post_id    ON analytics_events (post_id);
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events (event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events (created_at DESC);

-- ===== 006_indexes =====

-- ══════════════════════════════════════════════════════════════════════════
-- 006 — Hot-path indexes.
--
-- Partial indexes where applicable — published posts are 99% of public
-- traffic, so the index over that subset is small and fast.
-- ══════════════════════════════════════════════════════════════════════════

-- ── posts: geo feed + user dashboard + admin moderation ─────────────────

CREATE INDEX IF NOT EXISTS idx_posts_country_published
  ON posts (country_id, created_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_posts_provincia_published
  ON posts (provincia_id, created_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_posts_comuna
  ON posts (comuna_id)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_posts_barrio
  ON posts (barrio_id)
  WHERE status = 'published';

-- Dashboard: the logged-in user's posts.
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts (user_id);

-- Admin moderation queue.
CREATE INDEX IF NOT EXISTS idx_posts_moderation_status
  ON posts (created_at DESC)
  WHERE status IN ('pending', 'revision');




-- ── geo hierarchy (reverse lookups; UNIQUE already covers parent+slug) ────
-- See 003_geo_hierarchy.sql (parent_id indexes already created there).

-- ===== 007_rls_policies =====

-- ══════════════════════════════════════════════════════════════════════════
-- 007 — Row-Level Security: all policies in one idempotent file.
--
-- Pattern: DROP POLICY IF EXISTS → CREATE POLICY. That way re-running this
-- file doesn't fail even if the policies already exist (Postgres has no
-- CREATE OR REPLACE for policies).
--
-- Naming convention:
--   {table}_public_read      — SELECT for anon/authenticated (public data)
--   {table}_owner_{action}   — INSERT/UPDATE/DELETE for the owner
--   {table}_admin_{action}   — broad actions for admin (via profiles.is_admin)
--   {table}_service_write    — operations only the service-role key can do
--
-- All tables have RLS ENABLE; no exceptions. `profiles` also has FORCE RLS.
-- ══════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────
-- profiles
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own"      ON profiles;
DROP POLICY IF EXISTS "profiles_select_admin"    ON profiles;
DROP POLICY IF EXISTS "profiles_select_public"   ON profiles;
DROP POLICY IF EXISTS "profiles_update_own"      ON profiles;
DROP POLICY IF EXISTS "profiles_insert_signup"   ON profiles;

-- Public can read profile_slug + avatar_url + full_name when profile_public=true.
-- Simplified here: the owner always sees their profile; admins all; anon none.
-- If `/perfil/[slug]` needs public reads, add it above.
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.is_admin = true));

CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.is_admin = true));

-- Signup: handle_new_user() is SECURITY DEFINER and bypasses RLS on INSERT.
-- No INSERT policy needed; clients don't create profiles directly.


-- ──────────────────────────────────────────────────────────────────────────
-- posts (consolidated after the data-leak fix)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "posts_select"  ON posts;
DROP POLICY IF EXISTS "posts_insert"  ON posts;
DROP POLICY IF EXISTS "posts_update"  ON posts;
DROP POLICY IF EXISTS "posts_delete"  ON posts;

-- Public: only published + approved. Owner: their own (any status).
-- Admin: everything.
CREATE POLICY "posts_select" ON posts FOR SELECT
  USING (
    (status = 'published' AND is_approved = true)
    OR user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "posts_insert" ON posts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "posts_update" ON posts FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "posts_delete" ON posts FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );




-- ──────────────────────────────────────────────────────────────────────────
-- favorites
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "favorites_all_own" ON favorites;

CREATE POLICY "favorites_all_own" ON favorites FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());




-- ──────────────────────────────────────────────────────────────────────────
-- reports (admin-only — users never read others' reports)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_admin_all" ON reports;
DROP POLICY IF EXISTS "reports_insert"    ON reports;

CREATE POLICY "reports_admin_all" ON reports FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Anyone can report (even anon). Via /api/report if a rate-limit is needed.
CREATE POLICY "reports_insert" ON reports FOR INSERT
  WITH CHECK (true);


-- ──────────────────────────────────────────────────────────────────────────
-- categories + tiers (public read-only catalog)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiers      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_public_read" ON categories;
DROP POLICY IF EXISTS "categories_admin_write" ON categories;
DROP POLICY IF EXISTS "tiers_public_read"      ON tiers;

CREATE POLICY "categories_public_read" ON categories FOR SELECT USING (true);
CREATE POLICY "categories_admin_write" ON categories FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "tiers_public_read" ON tiers FOR SELECT USING (true);


-- ──────────────────────────────────────────────────────────────────────────
-- city_category_settings (admin manages per-country visibility)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE city_category_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ccs_public_read"  ON city_category_settings;
DROP POLICY IF EXISTS "ccs_admin_write"  ON city_category_settings;

CREATE POLICY "ccs_public_read" ON city_category_settings FOR SELECT USING (true);
CREATE POLICY "ccs_admin_write" ON city_category_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));


-- ──────────────────────────────────────────────────────────────────────────
-- geo hierarchy (public read, admin write)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE countries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE provincias ENABLE ROW LEVEL SECURITY;
ALTER TABLE comunas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE barrios    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "countries_public_read"  ON countries;
DROP POLICY IF EXISTS "provincias_public_read" ON provincias;
DROP POLICY IF EXISTS "comunas_public_read"    ON comunas;
DROP POLICY IF EXISTS "barrios_public_read"    ON barrios;
DROP POLICY IF EXISTS "countries_admin_write"  ON countries;
DROP POLICY IF EXISTS "provincias_admin_write" ON provincias;
DROP POLICY IF EXISTS "comunas_admin_write"    ON comunas;
DROP POLICY IF EXISTS "barrios_admin_write"    ON barrios;

CREATE POLICY "countries_public_read"  ON countries  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "provincias_public_read" ON provincias FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "comunas_public_read"    ON comunas    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "barrios_public_read"    ON barrios    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "countries_admin_write" ON countries FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "provincias_admin_write" ON provincias FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "comunas_admin_write" ON comunas FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "barrios_admin_write" ON barrios FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

GRANT SELECT ON countries, provincias, comunas, barrios TO anon, authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- Payments & subscriptions (service-role-only writes; owner-read)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE mp_payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE elite_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates       ENABLE ROW LEVEL SECURITY;

-- payment_transactions: owner reads own rows; writes only via service-role
-- (webhooks / payment routes), same model as mp_payments.
DROP POLICY IF EXISTS "payment_tx_owner_read" ON payment_transactions;
DROP POLICY IF EXISTS "payment_tx_admin_all"  ON payment_transactions;
CREATE POLICY "payment_tx_owner_read" ON payment_transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "payment_tx_admin_all" ON payment_transactions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS "mp_payments_owner_read"   ON mp_payments;
DROP POLICY IF EXISTS "credit_tx_owner_read"     ON credit_transactions;
DROP POLICY IF EXISTS "elite_subs_owner_read"     ON elite_subscriptions;
DROP POLICY IF EXISTS "exchange_rates_public"    ON exchange_rates;
DROP POLICY IF EXISTS "mp_payments_admin_all"    ON mp_payments;
DROP POLICY IF EXISTS "credit_tx_admin_all"      ON credit_transactions;
DROP POLICY IF EXISTS "elite_subs_admin_all"      ON elite_subscriptions;

CREATE POLICY "mp_payments_owner_read" ON mp_payments FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "credit_tx_owner_read" ON credit_transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "elite_subs_owner_read" ON elite_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "exchange_rates_public" ON exchange_rates FOR SELECT USING (true);

-- Admin override for debug / corrections:
CREATE POLICY "mp_payments_admin_all" ON mp_payments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "credit_tx_admin_all" ON credit_transactions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "elite_subs_admin_all" ON elite_subscriptions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));


-- ──────────────────────────────────────────────────────────────────────────
-- Misc (admin-only tables)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits       ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_chats     ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_admin_read"       ON audit_log;
DROP POLICY IF EXISTS "deletion_log_admin_read"    ON deletion_log;
DROP POLICY IF EXISTS "rate_limits_admin_read"     ON rate_limits;
DROP POLICY IF EXISTS "push_subs_owner_all"        ON push_subscriptions;
DROP POLICY IF EXISTS "support_chats_owner_all"    ON support_chats;
DROP POLICY IF EXISTS "support_chats_admin_all"    ON support_chats;
DROP POLICY IF EXISTS "analytics_insert"           ON analytics_events;
DROP POLICY IF EXISTS "analytics_admin_read"       ON analytics_events;

CREATE POLICY "audit_log_admin_read" ON audit_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "deletion_log_admin_read" ON deletion_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "rate_limits_admin_read" ON rate_limits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "push_subs_owner_all" ON push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "support_chats_owner_all" ON support_chats FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "support_chats_admin_all" ON support_chats FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));


-- analytics: anyone inserts events (view/click). Admin reads.
CREATE POLICY "analytics_insert" ON analytics_events FOR INSERT WITH CHECK (true);
CREATE POLICY "analytics_admin_read" ON analytics_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));


-- ══════════════════════════════════════════════════════════════════════════
-- Verification after running
-- ══════════════════════════════════════════════════════════════════════════
-- SELECT tablename, COUNT(*) AS n_policies
-- FROM pg_policies WHERE schemaname='public'
-- GROUP BY tablename ORDER BY tablename;
