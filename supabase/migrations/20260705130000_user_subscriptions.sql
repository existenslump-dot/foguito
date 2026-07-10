-- ══════════════════════════════════════════════════════════════════════════
-- Per-tier subscriptions with variable duration
--
-- Until now the model assumed a fixed 30 days: a payment activation credited
-- the balance and published posts expired after a hardcoded 30 days. This
-- change makes duration an attribute of the purchased package:
--
--   • `user_subscriptions`: one row per payment activation, with
--     `expires_at = now() + duration_days`. Post approval reads the owner's
--     active subscription to stamp the post's validity.
--   • `apply_payment_activation()` gains `p_duration_days` + `p_tier` and
--     creates the subscription row in the same atomic claim transaction.
--   • `elite_subscriptions.duration_days`: the Elite flow (NOWPayments
--     hosted) persists the duration when creating the order; the IPN uses it
--     to stamp `expires_at` instead of the fixed 30-day period.
--
-- Idempotent: re-applying this migration is a no-op.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Subscriptions table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL,
  package_id     TEXT NOT NULL,
  -- Public tier slug ('basic'…'elite'); NULL for tier-less SKUs (test).
  tier           TEXT,
  duration_days  INT  NOT NULL DEFAULT 30 CHECK (duration_days > 0),
  status         TEXT NOT NULL DEFAULT 'active',  -- active / expired / cancelled
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  -- Correlation with the payment that originated it (audit + idempotency).
  gateway        TEXT,
  gateway_tx_id  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_subs_user_id    ON user_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_subs_status     ON user_subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_user_subs_expires_at ON user_subscriptions (expires_at);

-- A gateway payment produces at most ONE subscription (replay-safe even
-- outside the payment_transactions claim — belt and suspenders).
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_subs_gateway_tx
  ON user_subscriptions (gateway, gateway_tx_id)
  WHERE gateway_tx_id IS NOT NULL;

-- updated_at trigger (function defined in the init migration).
DROP TRIGGER IF EXISTS user_subs_updated_at ON user_subscriptions;
CREATE TRIGGER user_subs_updated_at
  BEFORE UPDATE ON user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- RLS: a user reads their own subscription; an admin reads all (the listing
-- form in admin mode resolves the advertiser's duration client-side).
-- Writes: service role only (webhooks/RPC) — no INSERT/UPDATE policies.
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

-- public.is_admin() = SECURITY DEFINER helper (migration
-- fix_profiles_policy_recursion, earlier than this one): avoids re-entering
-- the profiles RLS from the policy.
DROP POLICY IF EXISTS user_subs_select_own_or_admin ON user_subscriptions;
CREATE POLICY user_subs_select_own_or_admin ON user_subscriptions
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_admin()
  );

-- Explicit SELECT-only grant (Supabase's default privileges already cover
-- this; kept explicit to document that the authenticated role is read-only
-- on this table).
GRANT SELECT ON user_subscriptions TO authenticated;

-- ── Duration in the Elite flow (separate table, NOWPayments hosted) ────────
ALTER TABLE elite_subscriptions
  ADD COLUMN IF NOT EXISTS duration_days INT NOT NULL DEFAULT 30;

-- ── apply_payment_activation(): + duration + tier ──────────────────────────
-- New signature (10 args). In Postgres, adding DEFAULT parameters creates an
-- OVERLOAD (it doesn't replace the old signature) → the 8-arg one must be
-- dropped explicitly or both would remain and calls would be ambiguous.
DROP FUNCTION IF EXISTS apply_payment_activation(TEXT, TEXT, UUID, TEXT, INT, NUMERIC, TEXT, TEXT);

-- Same as the previous version (exactly-once claim + credits + ledger),
-- with one new step: record the subscription with its real expiry.
-- Returns: 'applied' | 'already-applied' | 'no-user'
CREATE OR REPLACE FUNCTION apply_payment_activation(
  p_gateway        TEXT,
  p_gateway_tx_id  TEXT,
  p_user_id        UUID,
  p_package_id     TEXT,
  p_credits        INT,
  p_amount_usd     NUMERIC,
  p_payer_email    TEXT,
  p_order_ref      TEXT DEFAULT NULL,
  p_duration_days  INT  DEFAULT 30,
  p_tier           TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_credits INT;
  v_days    INT := GREATEST(COALESCE(p_duration_days, 30), 1);
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

  -- Subscription with the package's real expiry. The claim above already
  -- guarantees exactly-once; the ON CONFLICT on the partial unique index is
  -- a second line of defense against replays.
  INSERT INTO user_subscriptions
    (user_id, package_id, tier, duration_days, started_at, expires_at,
     status, gateway, gateway_tx_id)
  VALUES
    (v_user_id, p_package_id, p_tier, v_days, now(),
     now() + make_interval(days => v_days), 'active', p_gateway, p_gateway_tx_id)
  ON CONFLICT (gateway, gateway_tx_id) WHERE gateway_tx_id IS NOT NULL
  DO NOTHING;

  RETURN 'applied';
END;
$$;

-- Webhooks run with the service role; nothing client-side may call this.
REVOKE ALL ON FUNCTION apply_payment_activation(TEXT, TEXT, UUID, TEXT, INT, NUMERIC, TEXT, TEXT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_payment_activation(TEXT, TEXT, UUID, TEXT, INT, NUMERIC, TEXT, TEXT, INT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_payment_activation(TEXT, TEXT, UUID, TEXT, INT, NUMERIC, TEXT, TEXT, INT, TEXT) TO service_role;
