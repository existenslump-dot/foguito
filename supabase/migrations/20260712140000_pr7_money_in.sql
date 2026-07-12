-- ═══════════════════════════════════════════════════════════════════════════
-- PR-7 · MONEY-IN — dinero → foguitos (merchant-of-record, PAN cero).
--
-- Un fan compra foguitos con dinero real vía un procesador hosted (el PAN NUNCA
-- toca la app). Cuando un webhook FIRMADO confirma el pago, se acredita el
-- `credit_ledger` (doble entrada), débito a `platform:cash` (distinto de
-- `platform:promo` del top-up admin → paga vs promo auditable). El payout a
-- creadoras es PR-8: acá NO se toca `payouts` ni `platform:revenue`/`creator:*`.
--
-- Contiene:
--   1. `foguito_orders` — órdenes de compra pendientes (tracking server-side).
--      Escritura SOLO admin/service-role (RLS + guard). El fan sólo lee las suyas.
--   2. `purchase_foguitos(p_order_ref)` — RPC atómica SECURITY DEFINER (service-role
--      only): mira la orden, credita el ledger y marca la orden 'paid' en UNA
--      transacción, idempotente. El monto de foguitos sale de la ORDEN (fijado
--      server-side en el checkout desde el catálogo), NUNCA del webhook.
--
-- Idempotente (IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · foguito_orders — órdenes de compra ───────────────────────────────────
CREATE TABLE IF NOT EXISTS foguito_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref       TEXT NOT NULL UNIQUE,      -- id opaco propio (no enumerable), echo del provider
  provider        TEXT NOT NULL,             -- 'nowpayments' | 'ccbill' | …
  gateway_tx_id   TEXT,                       -- id del pago del provider (se setea tras createCheckout)
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_id         TEXT NOT NULL,             -- id del pack del catálogo (config)
  amount_foguitos BIGINT NOT NULL CHECK (amount_foguitos > 0),  -- lo que se acredita (server-authoritative)
  price_amount    NUMERIC(12,2) NOT NULL CHECK (price_amount > 0), -- monto esperado del cargo
  price_currency  TEXT NOT NULL,             -- 'USD' | …
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','failed','expired','canceled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, gateway_tx_id)           -- NULLs distintos ⇒ varias pending sin tx_id OK
);
CREATE INDEX IF NOT EXISTS idx_foguito_orders_user ON foguito_orders (user_id);
CREATE INDEX IF NOT EXISTS idx_foguito_orders_gw   ON foguito_orders (provider, gateway_tx_id);

ALTER TABLE foguito_orders ENABLE ROW LEVEL SECURITY;

-- El fan ve SÓLO sus órdenes (para la página de retorno); admin todo.
DROP POLICY IF EXISTS foguito_orders_select ON foguito_orders;
CREATE POLICY foguito_orders_select ON foguito_orders FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
-- Escritura SOLO admin (RLS); el service-role (checkout/webhook) bypassa RLS.
-- Un fan NUNCA escribe una orden (no puede auto-fijar pack/monto/estado).
DROP POLICY IF EXISTS foguito_orders_admin_write ON foguito_orders;
CREATE POLICY foguito_orders_admin_write ON foguito_orders FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Guard defensivo (espejo de subscriptions_guard): incluso si una política se
-- regresa, sólo admin/service-role escribe órdenes.
CREATE OR REPLACE FUNCTION public.foguito_orders_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_admin() OR public.is_service_role() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'foguito_orders: escritura sólo server-authoritative (checkout/webhook/admin)'
    USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS foguito_orders_guard_trg ON foguito_orders;
CREATE TRIGGER foguito_orders_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON foguito_orders
  FOR EACH ROW EXECUTE FUNCTION public.foguito_orders_guard();

DROP TRIGGER IF EXISTS foguito_orders_touch ON foguito_orders;
CREATE TRIGGER foguito_orders_touch BEFORE UPDATE ON foguito_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── 2 · purchase_foguitos — fulfilment atómico del pago confirmado ────────────
-- Llamada por el webhook (service-role) SÓLO tras verificar la firma + el monto
-- gateway-truth. Lee el monto de foguitos de la ORDEN (fijado server-side en el
-- checkout), nunca del webhook → el webhook no puede inyectar un monto. Credita
-- el ledger y marca la orden 'paid' en la MISMA transacción, idempotente.
CREATE OR REPLACE FUNCTION public.purchase_foguitos(p_order_ref text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user      uuid;
  v_amount    bigint;
  v_status    text;
  v_provider  text;
  v_txn       uuid;
BEGIN
  IF p_order_ref IS NULL OR p_order_ref = '' THEN RETURN 'invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('foguito_order:' || p_order_ref));

  SELECT user_id, amount_foguitos, status, provider
    INTO v_user, v_amount, v_status, v_provider
    FROM foguito_orders WHERE order_ref = p_order_ref;
  IF NOT FOUND THEN RETURN 'no_order'; END IF;

  -- Idempotencia: un webhook re-entregado no re-acredita.
  IF v_status = 'paid' THEN RETURN 'already_applied'; END IF;
  -- Sólo se cumple desde 'pending' (terminal-freeze: no revive failed/expired).
  IF v_status <> 'pending' THEN RETURN 'not_pending'; END IF;

  v_txn := gen_random_uuid();
  INSERT INTO credit_ledger (txn_id, account, user_id, direction, amount, reason, idempotency_key)
  VALUES
    (v_txn, 'user:' || v_user::text, v_user, 'credit', v_amount, 'purchase',
       'pay:' || v_provider || ':' || p_order_ref),
    (v_txn, 'platform:cash',          NULL,   'debit',  v_amount, 'purchase', NULL);

  UPDATE foguito_orders SET status = 'paid', updated_at = now() WHERE order_ref = p_order_ref;

  RETURN 'ok';
END;
$$;

-- Sólo service-role ejecuta la RPC (el webhook con getSupabaseAdmin()).
REVOKE ALL ON FUNCTION public.purchase_foguitos(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_foguitos(text) TO service_role;
