-- ═══════════════════════════════════════════════════════════════════════════
-- PR-10 · AML / sanciones — screening en las TRES superficies + trail + gate.
--
-- Las superficies CREADORA (onboarding) y PAYOUT (money-out) ya las cubre PR-8
-- (`creators.sanctions_status` + `advance_payout`/`payouts_guard` exigen 'clear').
-- Este PR agrega la tercera: el CONSUMIDOR (money-in), más el LOG append-only de
-- todos los screenings (trail AML + fuente de staleness para el rescreening batch)
-- y el gate DB-autoritativo en `purchase_foguitos`.
--
--   1. `sanctions_screenings` — log append-only de cada screen (deny-all RLS).
--   2. `profiles.consumer_sanctions_status` — flag fast-path del gate de money-in,
--      write-guardeado (el fan NO puede auto-clarearse: `profiles_update_own` no
--      tiene WITH CHECK por columna).
--   3. `creators.sanctions_screened_at` — staleness del rescreening (simétrico al
--      consumer); coaccionado por `creators_guard_privileged`.
--   4. `foguito_orders.status='held_aml'` + gate en `purchase_foguitos`: un
--      consumidor 'hit' NO recibe el crédito (la orden queda retenida).
--
-- Idempotente (IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · sanctions_screenings — log append-only (trail AML) ───────────────────
-- Una fila por screen, en cualquiera de las tres superficies. Deny-all: sólo el
-- service-role (que bypassa RLS) escribe/lee — un fan/creadora NUNCA ve el trail.
CREATE TABLE IF NOT EXISTS sanctions_screenings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('creator','consumer','payout')),
  subject_id    UUID NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('clear','review','hit')),
  provider      TEXT NOT NULL,             -- 'vendor' | 'stub'
  ref           TEXT,                       -- referencia opaca del screen del vendor
  screened_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sanctions_screenings_subject
  ON sanctions_screenings (subject_type, subject_id, screened_at DESC);

ALTER TABLE sanctions_screenings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sanctions_screenings FORCE ROW LEVEL SECURITY;  -- deny-all (cero políticas)

-- ── 2 · profiles.consumer_sanctions_status — flag del gate de money-in ───────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS consumer_sanctions_status TEXT
  NOT NULL DEFAULT 'none'
  CHECK (consumer_sanctions_status IN ('none','clear','review','hit'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS consumer_screened_at TIMESTAMPTZ;

-- Guard: `profiles_update_own` (USING id=auth.uid()) deja al fan escribir CUALQUIER
-- columna de su propia fila, sin WITH CHECK. Sin esto, un consumidor 'hit' podría
-- auto-setearse 'clear' por PostgREST directo y saltar el gate. Coacciona las dos
-- columnas AML a OLD para no-admin/no-service-role (en INSERT las fuerza al default).
-- NO tira (así jamás rompe el alta de perfil del signup); sólo neutraliza el intento.
CREATE OR REPLACE FUNCTION public.profiles_guard_aml()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_admin() OR public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.consumer_sanctions_status := 'none';
    NEW.consumer_screened_at      := NULL;
  ELSE
    NEW.consumer_sanctions_status := OLD.consumer_sanctions_status;
    NEW.consumer_screened_at      := OLD.consumer_screened_at;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_guard_aml_trg ON profiles;
CREATE TRIGGER profiles_guard_aml_trg
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_aml();
REVOKE ALL ON FUNCTION public.profiles_guard_aml() FROM public, anon, authenticated;

-- ── 3 · creators.sanctions_screened_at — staleness del rescreening ───────────
ALTER TABLE creators ADD COLUMN IF NOT EXISTS sanctions_screened_at TIMESTAMPTZ;

-- Re-declara `creators_guard_privileged` para congelar TAMBIÉN sanctions_screened_at
-- en no-admins (la versión de PR-0 no conocía la columna → un creator podría auto-
-- pisar el timestamp). Resto del contrato idéntico: kyc/age/payout/sanctions sólo
-- admin/service-role; en INSERT se fuerzan a los defaults seguros.
CREATE OR REPLACE FUNCTION public.creators_guard_privileged()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_admin() OR public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.kyc_status            := 'unverified';
    NEW.age_verified          := false;
    NEW.payout_kyc_status     := 'none';
    NEW.sanctions_status      := 'unscreened';
    NEW.sanctions_screened_at := NULL;
  ELSE
    NEW.kyc_status            := OLD.kyc_status;
    NEW.age_verified          := OLD.age_verified;
    NEW.payout_kyc_status     := OLD.payout_kyc_status;
    NEW.sanctions_status      := OLD.sanctions_status;
    NEW.sanctions_screened_at := OLD.sanctions_screened_at;
  END IF;
  RETURN NEW;
END;
$$;
-- El trigger ya existe (PR-0); el CREATE OR REPLACE de arriba basta. Lo re-aseguramos
-- idempotente por si una DB fresca aplica en otro orden.
DROP TRIGGER IF EXISTS creators_guard_privileged_trg ON creators;
CREATE TRIGGER creators_guard_privileged_trg
  BEFORE INSERT OR UPDATE ON creators
  FOR EACH ROW EXECUTE FUNCTION public.creators_guard_privileged();
REVOKE ALL ON FUNCTION public.creators_guard_privileged() FROM public, anon, authenticated;

-- ── 4 · foguito_orders.held_aml + gate en purchase_foguitos ──────────────────
ALTER TABLE foguito_orders DROP CONSTRAINT IF EXISTS foguito_orders_status_check;
ALTER TABLE foguito_orders ADD CONSTRAINT foguito_orders_status_check
  CHECK (status IN ('pending','paid','failed','expired','canceled','held_aml'));

-- Re-declara la RPC de fulfilment con el GATE AML del consumidor. Un consumidor
-- 'hit' NO recibe el crédito no-redimible: la orden queda 'held_aml' (el dinero ya
-- entró por el procesador; el alta de crédito se retiene hasta revisión manual).
-- 'review'/'clear'/'none' acreditan normal (los foguitos son no-redimibles y el
-- payout a la creadora está screeneado aparte — el 'hit' es el corte duro de OFAC).
-- Idempotente: un re-entregado sobre 'held_aml' devuelve 'aml_hold' sin re-tocar.
CREATE OR REPLACE FUNCTION public.purchase_foguitos(p_order_ref text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user            uuid;
  v_amount          bigint;
  v_status          text;
  v_provider        text;
  v_consumer_status text;
  v_txn             uuid;
BEGIN
  IF p_order_ref IS NULL OR p_order_ref = '' THEN RETURN 'invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('foguito_order:' || p_order_ref));

  SELECT user_id, amount_foguitos, status, provider
    INTO v_user, v_amount, v_status, v_provider
    FROM foguito_orders WHERE order_ref = p_order_ref;
  IF NOT FOUND THEN RETURN 'no_order'; END IF;

  -- Idempotencia / terminal-freeze.
  IF v_status = 'paid'     THEN RETURN 'already_applied'; END IF;
  IF v_status = 'held_aml' THEN RETURN 'aml_hold';       END IF;
  IF v_status <> 'pending' THEN RETURN 'not_pending';    END IF;

  -- GATE AML del consumidor. El fan 'hit' no acredita: orden retenida.
  SELECT consumer_sanctions_status INTO v_consumer_status FROM profiles WHERE id = v_user;
  IF v_consumer_status = 'hit' THEN
    UPDATE foguito_orders SET status = 'held_aml', updated_at = now() WHERE order_ref = p_order_ref;
    RETURN 'aml_hold';
  END IF;

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

REVOKE ALL ON FUNCTION public.purchase_foguitos(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_foguitos(text) TO service_role;

-- ── 5 · stale_consumer_payers — candidatos del rescreening batch ─────────────
-- Consumidores PAGADORES (≥1 foguito_order) NO 'hit' con frescura vencida, ya
-- distinct + ordenados + acotados EN LA DB. Reemplaza la materialización app-side
-- de foguito_orders (que truncaba sin DISTINCT/ORDER BY: un pagador sancionado
-- podía quedar fuera del slice y no re-screenearse nunca). No hay FK
-- profiles↔foguito_orders (la orden referencia auth.users), así que el join va acá.
CREATE OR REPLACE FUNCTION public.stale_consumer_payers(p_cutoff timestamptz, p_limit int)
RETURNS TABLE (id uuid, consumer_screened_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.consumer_screened_at
  FROM profiles p
  WHERE p.consumer_sanctions_status <> 'hit'
    AND (p.consumer_screened_at IS NULL OR p.consumer_screened_at < p_cutoff)
    AND EXISTS (SELECT 1 FROM foguito_orders o WHERE o.user_id = p.id)
  ORDER BY p.consumer_screened_at ASC NULLS FIRST
  LIMIT GREATEST(p_limit, 0);
$$;
REVOKE ALL ON FUNCTION public.stale_consumer_payers(timestamptz, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stale_consumer_payers(timestamptz, int) TO service_role;
