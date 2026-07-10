-- ══════════════════════════════════════════════════════════════════════════
-- Self-serve renewal
--
-- Until now, renewing a listing was admin-only (/api/admin/renew-post) or
-- concierge (a form the admin processes). This change lets a package payment
-- renew the listing on its own:
--
--   • `apply_payment_activation()` gains `p_renew_post_id`: if the payment
--     carries a renewal target and the post belongs to the credited user,
--     the activation extends `expires_at` by the package duration — inside
--     the same atomic claim, so a webhook replay doesn't extend twice. It
--     also resets the reminder flags (notified_5d/1d) so the new period gets
--     its own notices.
--   • `elite_subscriptions.renew_post_id`: the Elite flow (separate table)
--     persists the target on the order; the IPN applies it on activation.
--
-- The target travels from checkout to webhook via the JSONB metadata of the
-- pending row (mp_payments / payment_transactions), never from the webhook
-- payload. An invalid target (someone else's post or a nonexistent one) is a
-- silent no-op: the payment is still valid as a credits top-up.
--
-- Idempotent: re-applying this migration is a no-op.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE elite_subscriptions
  ADD COLUMN IF NOT EXISTS renew_post_id UUID;

-- New signature (11 args): drop the 10-arg one to avoid ambiguous overloads
-- (adding DEFAULT parameters creates an overload, it doesn't replace).
DROP FUNCTION IF EXISTS apply_payment_activation(TEXT, TEXT, UUID, TEXT, INT, NUMERIC, TEXT, TEXT, INT, TEXT);

-- Same as the previous version (exactly-once claim + credits + ledger +
-- subscription), with one new step: extend the post being renewed.
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
  p_tier           TEXT DEFAULT NULL,
  p_renew_post_id  UUID DEFAULT NULL
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

  -- Subscription with the package's real expiry (second line of defense
  -- against replays: partial unique index by gateway tx).
  INSERT INTO user_subscriptions
    (user_id, package_id, tier, duration_days, started_at, expires_at,
     status, gateway, gateway_tx_id)
  VALUES
    (v_user_id, p_package_id, p_tier, v_days, now(),
     now() + make_interval(days => v_days), 'active', p_gateway, p_gateway_tx_id)
  ON CONFLICT (gateway, gateway_tx_id) WHERE gateway_tx_id IS NOT NULL
  DO NOTHING;

  -- Self-serve renewal: extend the paid post. Only if it belongs to the
  -- credited user (someone else's/nonexistent target is a no-op: the payment
  -- still counts as a credits top-up). If the post already expired, extend
  -- from now; if still valid, from its current expiry. The claim above
  -- guarantees exactly-once, so replays don't re-extend.
  IF p_renew_post_id IS NOT NULL THEN
    UPDATE posts
       SET expires_at  = GREATEST(COALESCE(expires_at, now()), now())
                         + make_interval(days => v_days),
           notified_5d = false,
           notified_1d = false
     WHERE id = p_renew_post_id AND user_id = v_user_id;
  END IF;

  RETURN 'applied';
END;
$$;

-- Webhooks run with the service role; nothing client-side may call this.
REVOKE ALL ON FUNCTION apply_payment_activation(TEXT, TEXT, UUID, TEXT, INT, NUMERIC, TEXT, TEXT, INT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_payment_activation(TEXT, TEXT, UUID, TEXT, INT, NUMERIC, TEXT, TEXT, INT, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_payment_activation(TEXT, TEXT, UUID, TEXT, INT, NUMERIC, TEXT, TEXT, INT, TEXT, UUID) TO service_role;
