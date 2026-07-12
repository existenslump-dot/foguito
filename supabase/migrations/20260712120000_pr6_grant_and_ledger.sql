-- ═══════════════════════════════════════════════════════════════════════════
-- PR-6 · GRANT side — entitlements/PPV/suscripción + gasto de foguitos (ledger).
--
-- PR-5 entrega contenido leyendo el paywall (content_select). PR-6 permite que un
-- fan OBTENGA acceso GASTANDO foguitos (crédito de bucle cerrado), creando las
-- filas de entitlements/subscriptions — SERVER-AUTHORITATIVE, nunca desde el
-- cliente. El dinero→foguitos (top-up real) es PR-7; el payout a creadora, PR-8.
--
-- Contiene:
--   1. Columnas de precio de suscripción por creadora (modelo MVP: precio único).
--   2. LOCKDOWN de subscriptions: cierra el self-grant (un fan podía insertarse su
--      propia fila 'active' vía PostgREST y desbloquear todo el tier gratis).
--   3. Guards defensivos en subscriptions/entitlements (sólo admin/service-role).
--   4. RPCs atómicas SECURITY DEFINER: unlock_ppv_content, subscribe_creator,
--      credit_foguitos (top-up admin/stub). Lock por-fan + chequeo de saldo +
--      doble-entrada + idempotencia + re-guard pilar #0 (published + csam pass).
--
-- Idempotente (IF EXISTS / OR REPLACE / DROP … IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Modelo de precio de suscripción (MVP: precio único por creadora) ──────
-- Decisión PR-6: una suscripción vigente desbloquea TODO el contenido
-- visibility='tier' de esa creadora (el gating por RANGO de tier —bronze<gold— se
-- difiere a un PR posterior, cuando haya catálogo de tiers). El PPV es aparte
-- (compra por-pieza). NULL/0 en sub_price_foguitos ⇒ la creadora no ofrece subs.
ALTER TABLE creators ADD COLUMN IF NOT EXISTS sub_price_foguitos INT;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS sub_period_days INT NOT NULL DEFAULT 30;
-- sub_price_foguitos/sub_period_days NO son privilegiadas: la creadora las setea
-- ella misma (creators_update owner) y creators_guard_privileged no las coacciona.

-- ── 2 · LOCKDOWN subscriptions — cerrar el self-grant ────────────────────────
-- Antes: subscriptions_write FOR ALL USING/​WITH CHECK (fan_id = auth.uid() OR
-- is_admin()) → un fan se insertaba/actualizaba su propia suscripción 'active' y
-- desbloqueaba gratis el tier de cualquier creadora. Ahora la escritura es SOLO
-- admin (RLS) / service-role (bypass) — el fan pasa por subscribe_creator().
DROP POLICY IF EXISTS subscriptions_write ON subscriptions;
DROP POLICY IF EXISTS subscriptions_admin_write ON subscriptions;
CREATE POLICY subscriptions_admin_write ON subscriptions FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── 3 · Guards defensivos (defensa en profundidad, espejo del patrón del repo) ─
-- Aunque la RLS ya bloquea al no-admin, el trigger garantiza que una futura
-- regresión de política no reabra el self-grant: sólo admin/service-role escriben.
CREATE OR REPLACE FUNCTION public.subscriptions_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_admin() OR public.is_service_role() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'subscriptions: escritura sólo server-authoritative (subscribe_creator/admin)'
    USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS subscriptions_guard_trg ON subscriptions;
CREATE TRIGGER subscriptions_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_guard();

CREATE OR REPLACE FUNCTION public.entitlements_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_admin() OR public.is_service_role() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'entitlements: escritura sólo server-authoritative (unlock/grant/admin)'
    USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS entitlements_guard_trg ON entitlements;
CREATE TRIGGER entitlements_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON entitlements
  FOR EACH ROW EXECUTE FUNCTION public.entitlements_guard();

-- ── 4 · RPCs atómicas de gasto/otorgamiento ──────────────────────────────────
-- Todas SECURITY DEFINER (corren como owner → bypass RLS) + search_path fijo, y
-- SOLO ejecutables por service_role (los endpoints con service-role). El lock
-- por-fan (pg_advisory_xact_lock) serializa gastos concurrentes del mismo fan →
-- sin doble-gasto ni saldo negativo. Precio SIEMPRE de la DB, nunca del cliente.
-- Toda la operación (débito + otorgamiento) es UNA transacción → atómica.

-- 4a · unlock_ppv_content — comprar una pieza PPV.
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

  -- Anti self-deal (espejo de subscribe_creator): la creadora NO compra su propia
  -- pieza. Ya la ve por RLS (creator_id=auth.uid()); permitirlo sólo sembraría una
  -- pata 'ppv' en platform:revenue auto-atribuida (semilla de gaming del payout PR-8).
  IF v_creator = p_fan THEN RETURN 'invalid'; END IF;

  -- Pilar #0 + paywall: SÓLO un PPV publicado y con CSAM 'pass' es comprable.
  -- Nunca se cobra por desbloquear borrador/bloqueado/sin escanear.
  IF v_visibility <> 'ppv' OR v_status <> 'published' OR v_csam <> 'pass' THEN
    RETURN 'not_purchasable';
  END IF;
  IF v_price IS NULL OR v_price <= 0 THEN RETURN 'no_price'; END IF;

  -- Idempotencia: ya desbloqueado ⇒ no re-cobra (UNIQUE(fan_id,content_id)).
  IF EXISTS (SELECT 1 FROM entitlements WHERE fan_id = p_fan AND content_id = p_content) THEN
    RETURN 'already_unlocked';
  END IF;

  SELECT coalesce(SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END), 0)
    INTO v_balance FROM credit_ledger WHERE account = 'user:' || p_fan::text;
  IF v_balance < v_price THEN RETURN 'insufficient_funds'; END IF;

  v_txn := gen_random_uuid();
  INSERT INTO credit_ledger (txn_id, account, user_id, direction, amount, reason, idempotency_key)
  VALUES
    (v_txn, 'user:' || p_fan::text, p_fan, 'debit',  v_price, 'ppv',
       'ppv:' || p_content::text || ':' || p_fan::text),
    (v_txn, 'platform:revenue',     NULL,  'credit', v_price, 'ppv', NULL);

  INSERT INTO entitlements (fan_id, content_id, source, expires_at)
  VALUES (p_fan, p_content, 'ppv', NULL);

  RETURN 'ok';
END;
$$;

-- 4b · subscribe_creator — suscribirse a una creadora (precio único MVP).
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

  -- Ya suscripto y vigente ⇒ no re-cobra (idempotente ante doble-click/retry).
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
  INSERT INTO credit_ledger (txn_id, account, user_id, direction, amount, reason, idempotency_key)
  VALUES
    (v_txn, 'user:' || p_fan::text, p_fan, 'debit',  v_price, 'subscription', NULL),
    (v_txn, 'platform:revenue',     NULL,  'credit', v_price, 'subscription', NULL);

  INSERT INTO subscriptions (fan_id, creator_id, tier, status, started_at, expires_at, updated_at)
  VALUES (p_fan, p_creator, 'standard', 'active', now(), now() + (v_days || ' days')::interval, now())
  ON CONFLICT (fan_id, creator_id) DO UPDATE
    SET status = 'active', tier = 'standard', started_at = now(),
        expires_at = now() + (v_days || ' days')::interval, updated_at = now();

  RETURN 'ok';
END;
$$;

-- 4c · credit_foguitos — top-up (admin/stub; el money-in real es PR-7).
-- Doble entrada: crédito a user:<fan>, débito a platform:promo (crédito
-- promocional mientras no haya cobro real). Idempotente por idempotency_key.
CREATE OR REPLACE FUNCTION public.credit_foguitos(
  p_user uuid, p_amount bigint, p_reason text, p_idempotency_key text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_txn uuid;
BEGIN
  IF p_user IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN RETURN 'invalid'; END IF;
  IF p_idempotency_key IS NOT NULL
     AND EXISTS (SELECT 1 FROM credit_ledger WHERE idempotency_key = p_idempotency_key) THEN
    RETURN 'already_applied';
  END IF;

  v_txn := gen_random_uuid();
  INSERT INTO credit_ledger (txn_id, account, user_id, direction, amount, reason, idempotency_key)
  VALUES
    (v_txn, 'user:' || p_user::text, p_user, 'credit', p_amount, coalesce(p_reason, 'topup'), p_idempotency_key),
    (v_txn, 'platform:promo',        NULL,   'debit',  p_amount, coalesce(p_reason, 'topup'), NULL);

  RETURN 'ok';
END;
$$;

-- Sólo service-role ejecuta las RPCs (los endpoints con getSupabaseAdmin()).
-- Un authenticated/anon NO puede llamarlas por PostgREST (sin EXECUTE → 403).
REVOKE ALL ON FUNCTION public.unlock_ppv_content(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscribe_creator(uuid, uuid)   FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_foguitos(uuid, bigint, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_ppv_content(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscribe_creator(uuid, uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_foguitos(uuid, bigint, text, text) TO service_role;
