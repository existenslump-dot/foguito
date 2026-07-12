-- ═══════════════════════════════════════════════════════════════════════════
-- PR-8 · MONEY-OUT — revenue-share + payout REGULADO a creadoras.
--
-- El leg de mayor exposición regulatoria: pagar a la creadora sus earnings al
-- mundo real (VASP/PSP + Travel Rule + sanciones + payout-KYC). Los foguitos NO
-- son redimibles por el fan; el payout es el cash-out de la CREADORA, gateado.
--
-- ⚠️ GAP que cierra: hasta PR-7, TODO el gasto del fan iba a `platform:revenue` —
-- la creadora acumulaba CERO balance pagable. PR-8 introduce el SPLIT en el gasto:
-- el share de la creadora va a `creator:<uuid>:earnings`, el take de la plataforma
-- a `platform:revenue`. Doble entrada intacta (los créditos suman = débito).
--
-- Contiene:
--   1. Placeholders de negocio (take-rate + conversión foguito→USD). ⚠️ el founder
--      fija los números reales (una sola fuente server-authoritative).
--   2. `ledger_split_spend` — helper de la entrada de 3 patas balanceada.
--   3. CREATE OR REPLACE de unlock_ppv_content / subscribe_creator con el split.
--   4. `payouts.amount_foguitos` (la reserva en foguitos, para revertir exacto).
--   5. `request_payout` / `advance_payout` — RPCs atómicas SECURITY DEFINER
--      (service-role only): overdraft-guard + re-check payout-KYC/sanciones +
--      reserva por débito + máquina de estados + reversa compensatoria en 'failed'.
--
-- Idempotente (CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS / REVOKE-GRANT).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Placeholders de negocio (⚠️ el founder fija los valores reales) ───────
-- Take de la plataforma en basis points. 2000 = 20% plataforma / 80% creadora.
CREATE OR REPLACE FUNCTION public.platform_take_bps()
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 2000 $$;
-- Conversión foguitos→USD para el payout (foguitos por 1 USD). 100 espeja el rate
-- de compra de los packs (pack_500 = 500 foguitos / 5 USD). ⚠️ placeholder.
CREATE OR REPLACE FUNCTION public.foguitos_per_usd()
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 100 $$;

-- ── 2 · Helper del split (entrada de 3 patas balanceada) ──────────────────────
-- Débito user:<fan> por el total; crédito platform:revenue el take; crédito
-- creator:<c>:earnings el resto. Suma de créditos = débito ⇒ el ledger cuadra.
-- Patas de monto 0 se OMITEN (credit_ledger CHECK amount>0). Se llama SÓLO desde
-- las RPCs de gasto (SECURITY DEFINER, owner) — REVOKE al público.
CREATE OR REPLACE FUNCTION public.ledger_split_spend(
  p_txn uuid, p_fan uuid, p_creator uuid, p_amount int, p_reason text, p_fan_idem text)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_take  int := (p_amount * public.platform_take_bps()) / 10000;  -- floor entero
  v_share int;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'ledger_split_spend: amount<=0'; END IF;
  v_share := p_amount - v_take;  -- el resto a la creadora (siempre >= 0)

  INSERT INTO credit_ledger (txn_id, account, user_id, direction, amount, reason, idempotency_key)
  VALUES (p_txn, 'user:' || p_fan::text, p_fan, 'debit', p_amount, p_reason, p_fan_idem);

  IF v_take > 0 THEN
    INSERT INTO credit_ledger (txn_id, account, user_id, direction, amount, reason, idempotency_key)
    VALUES (p_txn, 'platform:revenue', NULL, 'credit', v_take, p_reason, NULL);
  END IF;

  IF v_share > 0 THEN
    INSERT INTO credit_ledger (txn_id, account, user_id, direction, amount, reason, idempotency_key)
    VALUES (p_txn, 'creator:' || p_creator::text || ':earnings', NULL, 'credit', v_share, p_reason, NULL);
  END IF;
END;
$$;

-- ── 3 · Spend RPCs con el split (CREATE OR REPLACE de las de PR-6) ────────────
-- unlock_ppv_content: idéntica a PR-6 salvo la entrada de ledger (ahora split).
CREATE OR REPLACE FUNCTION public.unlock_ppv_content(p_fan uuid, p_content uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_creator    uuid;
  v_visibility text;
  v_status     text;
  v_csam       text;
  v_price      int;
  v_balance    bigint;
  v_txn        uuid;
BEGIN
  IF p_fan IS NULL OR p_content IS NULL THEN RETURN 'invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('foguitos:' || p_fan::text));

  SELECT creator_id, visibility, status, csam_status, ppv_price_credits
    INTO v_creator, v_visibility, v_status, v_csam, v_price
    FROM content WHERE id = p_content;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_creator = p_fan THEN RETURN 'invalid'; END IF;  -- anti self-deal
  IF v_visibility <> 'ppv' OR v_status <> 'published' OR v_csam <> 'pass' THEN
    RETURN 'not_purchasable';
  END IF;
  IF v_price IS NULL OR v_price <= 0 THEN RETURN 'no_price'; END IF;
  IF EXISTS (SELECT 1 FROM entitlements WHERE fan_id = p_fan AND content_id = p_content) THEN
    RETURN 'already_unlocked';
  END IF;

  SELECT coalesce(SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END), 0)
    INTO v_balance FROM credit_ledger WHERE account = 'user:' || p_fan::text;
  IF v_balance < v_price THEN RETURN 'insufficient_funds'; END IF;

  v_txn := gen_random_uuid();
  -- SPLIT: fan → platform:revenue (take) + creator:<c>:earnings (share).
  PERFORM public.ledger_split_spend(
    v_txn, p_fan, v_creator, v_price, 'ppv',
    'ppv:' || p_content::text || ':' || p_fan::text);

  INSERT INTO entitlements (fan_id, content_id, source, expires_at)
  VALUES (p_fan, p_content, 'ppv', NULL);

  RETURN 'ok';
END;
$$;

-- subscribe_creator: idéntica a PR-6 salvo la entrada de ledger (ahora split).
CREATE OR REPLACE FUNCTION public.subscribe_creator(p_fan uuid, p_creator uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_price   int;
  v_days    int;
  v_balance bigint;
  v_txn     uuid;
BEGIN
  IF p_fan IS NULL OR p_creator IS NULL OR p_fan = p_creator THEN RETURN 'invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('foguitos:' || p_fan::text));

  SELECT sub_price_foguitos, coalesce(sub_period_days, 30)
    INTO v_price, v_days FROM creators WHERE user_id = p_creator;
  IF NOT FOUND OR v_price IS NULL OR v_price <= 0 THEN RETURN 'subs_not_offered'; END IF;

  IF EXISTS (
    SELECT 1 FROM subscriptions
    WHERE fan_id = p_fan AND creator_id = p_creator
      AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN 'already_active';
  END IF;

  SELECT coalesce(SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END), 0)
    INTO v_balance FROM credit_ledger WHERE account = 'user:' || p_fan::text;
  IF v_balance < v_price THEN RETURN 'insufficient_funds'; END IF;

  v_txn := gen_random_uuid();
  -- SPLIT: fan → platform:revenue (take) + creator:<c>:earnings (share).
  PERFORM public.ledger_split_spend(v_txn, p_fan, p_creator, v_price, 'subscription', NULL);

  INSERT INTO subscriptions (fan_id, creator_id, tier, status, started_at, expires_at, updated_at)
  VALUES (p_fan, p_creator, 'standard', 'active', now(), now() + (v_days || ' days')::interval, now())
  ON CONFLICT (fan_id, creator_id) DO UPDATE
    SET status = 'active', tier = 'standard', started_at = now(),
        expires_at = now() + (v_days || ' days')::interval, updated_at = now();

  RETURN 'ok';
END;
$$;

-- ── 4 · payouts.amount_foguitos — la reserva en foguitos (revierte exacto) ────
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS amount_foguitos BIGINT;

-- Estado intermedio 'sending' (claim atómico antes de tocar el VASP → evita
-- doble-transferencia en un race de dos 'send' concurrentes). Idempotente.
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('pending','approved','sending','sent','failed','held'));

-- ── 5 · Payout RPCs (atómicas, server-authoritative) ──────────────────────────
-- request_payout — la creadora pide retirar N foguitos de sus earnings.
-- Reserva por débito (creator:earnings → platform:payable) para que un segundo
-- request no doble-gaste; gate payout-KYC/sanciones (defense-in-depth, el
-- payouts_guard back-stopea el 'sent'); overdraft-guard (el guard NO lo hace).
CREATE OR REPLACE FUNCTION public.request_payout(p_creator uuid, p_amount_foguitos bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kyc      text;
  v_sanc     text;
  v_earnings bigint;
  v_usdt     numeric;
  v_txn      uuid;
BEGIN
  IF p_creator IS NULL OR p_amount_foguitos IS NULL OR p_amount_foguitos <= 0 THEN RETURN 'invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('payout:' || p_creator::text));

  SELECT payout_kyc_status, sanctions_status INTO v_kyc, v_sanc
    FROM creators WHERE user_id = p_creator;
  IF NOT FOUND OR v_kyc <> 'verified' OR v_sanc <> 'clear' THEN RETURN 'not_eligible'; END IF;

  -- Un solo payout en vuelo por creadora (idempotente ante doble-click). Incluye
  -- 'sending' (claim en curso) y 'held' (retenido por compliance) → no se apilan
  -- pedidos mientras uno está en vuelo o bajo hold.
  IF EXISTS (
    SELECT 1 FROM payouts WHERE creator_id = p_creator
      AND status IN ('pending','approved','sending','held')
  ) THEN
    RETURN 'already_pending';
  END IF;

  -- Earnings pagables = SUM sobre creator:<c>:earnings (las reservas previas ya
  -- están debitadas de esta cuenta ⇒ no hay doble-gasto de earnings en vuelo).
  SELECT coalesce(SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END), 0)
    INTO v_earnings FROM credit_ledger WHERE account = 'creator:' || p_creator::text || ':earnings';
  IF v_earnings < p_amount_foguitos THEN RETURN 'insufficient_earnings'; END IF;

  v_usdt := round(p_amount_foguitos::numeric / public.foguitos_per_usd(), 6);
  IF v_usdt <= 0 THEN RETURN 'amount_too_small'; END IF;

  -- Reserva: earnings de la creadora → platform:payable (obligación pendiente).
  v_txn := gen_random_uuid();
  INSERT INTO credit_ledger (txn_id, account, user_id, direction, amount, reason, idempotency_key)
  VALUES
    (v_txn, 'creator:' || p_creator::text || ':earnings', NULL, 'debit',  p_amount_foguitos, 'payout_reserve', NULL),
    (v_txn, 'platform:payable',                            NULL, 'credit', p_amount_foguitos, 'payout_reserve', NULL);

  INSERT INTO payouts (creator_id, amount_usdt, amount_foguitos, status)
  VALUES (p_creator, v_usdt, p_amount_foguitos, 'pending');

  RETURN 'ok';
END;
$$;

-- advance_payout — mueve la máquina de estados (admin/compliance/VASP callback).
-- pending→approved|held|failed ; approved→sent|held|failed ; held→approved|failed.
-- En 'sent' exige travel_rule_ref + payout-KYC/sanciones (pre-check + el guard
-- back-stopea). En 'failed' revierte la reserva (entrada compensatoria).
CREATE OR REPLACE FUNCTION public.advance_payout(
  p_payout uuid, p_new_status text,
  p_travel_rule_ref text DEFAULT NULL, p_sanctions_ref text DEFAULT NULL,
  p_vasp_tx_id text DEFAULT NULL, p_tax_withholding numeric DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur      text;
  v_creator  uuid;
  v_foguitos bigint;
  v_tr       text;
  v_txn      uuid;
BEGIN
  IF p_payout IS NULL OR p_new_status IS NULL THEN RETURN 'invalid'; END IF;
  IF p_new_status NOT IN ('approved','sending','sent','failed','held') THEN RETURN 'invalid_status'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('payout_row:' || p_payout::text));

  SELECT status, creator_id, amount_foguitos, travel_rule_ref
    INTO v_cur, v_creator, v_foguitos, v_tr
    FROM payouts WHERE id = p_payout FOR UPDATE;
  IF NOT FOUND THEN RETURN 'no_payout'; END IF;

  -- Terminal-freeze: no se sale de 'sent'/'failed'.
  IF v_cur IN ('sent','failed') THEN
    RETURN CASE WHEN v_cur = p_new_status THEN 'already' ELSE 'terminal' END;
  END IF;

  -- Máquina de estados:
  --   pending  → approved | held | failed
  --   approved → sending  | held | failed
  --   sending  → sent     | failed         (claim atómico antes del VASP)
  --   held     → approved | failed
  -- 'sending' es el CLAIM: sólo un 'send' concurrente gana approved→sending (el
  -- advisory lock serializa); el resto ve v_cur='sending' → bad_transition y NO
  -- toca el VASP. Los refs (travel_rule/sanctions) se estampan en este claim →
  -- persisten ANTES de la transferencia, así el webhook puede completar 'sent'.
  IF p_new_status = 'approved' AND v_cur NOT IN ('pending','held')       THEN RETURN 'bad_transition'; END IF;
  IF p_new_status = 'sending'  AND v_cur <> 'approved'                    THEN RETURN 'bad_transition'; END IF;
  IF p_new_status = 'sent'     AND v_cur <> 'sending'                     THEN RETURN 'bad_transition'; END IF;
  IF p_new_status = 'held'     AND v_cur NOT IN ('pending','approved','sending') THEN RETURN 'bad_transition'; END IF;

  -- Gate del 'sent' (pre-check; el payouts_guard es el back-stop autoritativo).
  IF p_new_status = 'sent' THEN
    IF coalesce(p_travel_rule_ref, v_tr) IS NULL THEN RETURN 'missing_travel_rule'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM creators c
      WHERE c.user_id = v_creator AND c.payout_kyc_status = 'verified' AND c.sanctions_status = 'clear'
    ) THEN RETURN 'not_eligible'; END IF;
  END IF;

  UPDATE payouts SET
    status          = p_new_status,
    travel_rule_ref = coalesce(p_travel_rule_ref, travel_rule_ref),
    sanctions_ref   = coalesce(p_sanctions_ref, sanctions_ref),
    vasp_tx_id      = coalesce(p_vasp_tx_id, vasp_tx_id),
    tax_withholding = coalesce(p_tax_withholding, tax_withholding),
    updated_at      = now()
  WHERE id = p_payout;

  -- 'failed' ⇒ revertir la reserva a los earnings de la creadora (compensatorio,
  -- el ledger es inmutable: una corrección es un asiento nuevo, nunca un edit).
  IF p_new_status = 'failed' AND v_foguitos IS NOT NULL AND v_foguitos > 0 THEN
    v_txn := gen_random_uuid();
    INSERT INTO credit_ledger (txn_id, account, user_id, direction, amount, reason, idempotency_key)
    VALUES
      (v_txn, 'platform:payable',                            NULL, 'debit',  v_foguitos, 'payout_reversal', NULL),
      (v_txn, 'creator:' || v_creator::text || ':earnings', NULL, 'credit', v_foguitos, 'payout_reversal', NULL);
  END IF;

  RETURN 'ok';
END;
$$;

-- ── Grants: las funciones de economía interna NO son callables por el fan ─────
REVOKE ALL ON FUNCTION public.ledger_split_spend(uuid, uuid, uuid, int, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_payout(uuid, bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_payout(uuid, text, text, text, text, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_payout(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_payout(uuid, text, text, text, text, numeric) TO service_role;
