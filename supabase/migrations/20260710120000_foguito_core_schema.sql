-- ═══════════════════════════════════════════════════════════════════════════
-- FOGUITO · PR-0(b) — esquema núcleo de contenido-con-pago + gates de seguridad
--
-- Agrega, sobre el engine heredado (profiles/posts/audit_log/…), las tablas de
-- la plataforma de suscripción y — lo importante — los TRIGGERS que hacen cierto
-- el pilar #0 a nivel DB: NADA se publica sin creadora verificada 18+, 2257
-- completo de cada performer, y CSAM pasado. El gate es de DB (no disciplina de
-- cliente): ni admin ni service-role pueden saltearlo.
--
-- Idempotente (CREATE … IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE).
-- Patrón de admin: public.is_admin() (SECURITY DEFINER, recursion-safe) del engine.
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- Helper: ¿el caller es service-role? (para dejar pasar webhooks/scanners a los
-- campos privilegiados; el resto se coacciona a OLD). auth.role() = claim del JWT.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(auth.role(), '') = 'service_role';
$$;
REVOKE ALL ON FUNCTION public.is_service_role() FROM public;
GRANT EXECUTE ON FUNCTION public.is_service_role() TO authenticated, anon, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 1 · creators — un profile que es creadora. Estado de verificación/payout.
--     Los campos privilegiados los setea Didit/admin/service-role, NO la propia
--     creadora (guard abajo). Sin kyc_status='verified' + age_verified → no publica.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS creators (
  user_id           UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pseudonym         TEXT,
  country           TEXT,
  -- Verificación 18+ (Didit) — PR-1
  kyc_status        TEXT NOT NULL DEFAULT 'unverified'
                      CHECK (kyc_status IN ('unverified','pending','verified','rejected')),
  age_verified      BOOLEAN NOT NULL DEFAULT false,
  age_verified_at   TIMESTAMPTZ,
  didit_session_id  TEXT,
  -- Payout (la pata regulada) — PR-8
  payout_kyc_status TEXT NOT NULL DEFAULT 'none'
                      CHECK (payout_kyc_status IN ('none','pending','verified','rejected')),
  sanctions_status  TEXT NOT NULL DEFAULT 'unscreened'
                      CHECK (sanctions_status IN ('unscreened','clear','review','hit')),
  onboarded_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════
-- 2 · performers_2257 — cada persona que aparece en contenido (creadora +
--     colaboradores). Datos legales cifrados por la app (patrón DIDIT_PAYLOAD_KEY).
--     is_complete / dob_verified los setea admin/service-role (guard), no el alta.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS performers_2257 (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  added_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  legal_name_enc     TEXT,                 -- cifrado AES por la app
  id_doc_path        TEXT,                 -- path en bucket privado identity-documents
  didit_session_id   TEXT,
  custodian          TEXT,                 -- custodio de records 2257
  dob_verified       BOOLEAN NOT NULL DEFAULT false,
  is_complete        BOOLEAN NOT NULL DEFAULT false,  -- gate: sin esto no se publica
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_performers_added_by ON performers_2257 (added_by);

-- ══════════════════════════════════════════════════════════════════════════
-- 3 · content — pieza de contenido pagado. Workflow con CSAM gate pre-publicación.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS content (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title              TEXT,
  caption            TEXT,
  media_ref          TEXT,                 -- path privado / cloudinary firmado (PR-5)
  media_type         TEXT CHECK (media_type IN ('image','video','audio')),
  -- Paywall
  visibility         TEXT NOT NULL DEFAULT 'tier'
                      CHECK (visibility IN ('free_preview','tier','ppv')),
  required_tier      TEXT,                 -- para visibility='tier'
  ppv_price_credits  INT,                  -- foguitos, para visibility='ppv'
  -- Moderación / seguridad
  status             TEXT NOT NULL DEFAULT 'uploaded'
                      CHECK (status IN ('uploaded','csam_scanning','in_review','published','rejected','removed')),
  csam_status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK (csam_status IN ('pending','pass','blocked')),
  csam_scanned_at    TIMESTAMPTZ,
  published_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_creator ON content (creator_id);
CREATE INDEX IF NOT EXISTS idx_content_status  ON content (status);

-- 4 · content_performers — N:M content↔performers (el gate 2257)
CREATE TABLE IF NOT EXISTS content_performers (
  content_id    UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  performer_id  UUID NOT NULL REFERENCES performers_2257(id) ON DELETE RESTRICT,
  PRIMARY KEY (content_id, performer_id)
);

-- 5 · subscriptions — fan "prende" a una creadora en un tier
CREATE TABLE IF NOT EXISTS subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fan_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creator_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier         TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','canceled')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fan_id, creator_id)
);
CREATE INDEX IF NOT EXISTS idx_subs_fan ON subscriptions (fan_id);
CREATE INDEX IF NOT EXISTS idx_subs_creator ON subscriptions (creator_id);

-- 6 · entitlements — acceso a una pieza (PPV / unlock por tip / preview)
CREATE TABLE IF NOT EXISTS entitlements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fan_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_id  UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('subscription','ppv','tip_unlock','free')),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  UNIQUE (fan_id, content_id)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_fan ON entitlements (fan_id);

-- ══════════════════════════════════════════════════════════════════════════
-- 7 · credit_ledger — foguitos, DOBLE ENTRADA, append-only. No redimible, no
--     transferible (regla de producto + guard de inmutabilidad abajo). El
--     balance de una cuenta = SUM(credit) - SUM(debit). PR-6 endurece las reglas.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS credit_ledger (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txn_id           UUID NOT NULL,          -- agrupa las patas de una transacción
  account          TEXT NOT NULL,          -- ej: 'user:<uuid>' | 'platform:revenue' | 'creator:<uuid>:earnings'
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount           BIGINT NOT NULL CHECK (amount > 0),   -- foguitos (entero, positivo)
  reason           TEXT NOT NULL,          -- purchase/subscription/ppv/tip/payout/refund
  idempotency_key  TEXT UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON credit_ledger (account);
CREATE INDEX IF NOT EXISTS idx_ledger_txn     ON credit_ledger (txn_id);

-- ══════════════════════════════════════════════════════════════════════════
-- 8 · payouts — revenue-share a la creadora (la pata regulada). Admin/service
--     only. Gated por KYC + sanciones + Travel Rule (guard abajo). PR-8.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_usdt       NUMERIC(18,6) NOT NULL CHECK (amount_usdt > 0),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','sent','failed','held')),
  travel_rule_ref   TEXT,
  sanctions_ref     TEXT,
  tax_withholding   NUMERIC(18,6),
  vasp_tx_id        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payouts_creator ON payouts (creator_id);

-- 9 · age_gate_verifications — verificación real del viewer por jurisdicción (PR-4)
CREATE TABLE IF NOT EXISTS age_gate_verifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  jurisdiction  TEXT NOT NULL,            -- ISO país/estado del viewer
  method        TEXT NOT NULL,            -- didit/yoti/… (no autodeclaración)
  verified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agegate_user ON age_gate_verifications (user_id);

-- updated_at touch (reusa touch_updated_at() del engine)
DROP TRIGGER IF EXISTS creators_touch ON creators;
CREATE TRIGGER creators_touch BEFORE UPDATE ON creators
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS content_touch ON content;
CREATE TRIGGER content_touch BEFORE UPDATE ON content
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS performers_touch ON performers_2257;
CREATE TRIGGER performers_touch BEFORE UPDATE ON performers_2257
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS payouts_touch ON payouts;
CREATE TRIGGER payouts_touch BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- GATE #0 (BLOQUEANTE) · content_publish_guard
-- Impide que content pase a 'published' sin: (1) CSAM pasado, (2) creadora
-- verificada 18+, (3) ≥1 performer 2257 y TODOS los performers con 2257 completo.
-- SECURITY DEFINER: corre aunque el escritor sea service-role o admin — el gate
-- es absoluto. El scanner CSAM setea csam_status='pass' antes de publicar.
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.content_publish_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN

    IF NEW.csam_status <> 'pass' THEN
      RAISE EXCEPTION 'content_publish_guard: CSAM gate no pasado (csam_status=%)', NEW.csam_status
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM creators c
      WHERE c.user_id = NEW.creator_id
        AND c.kyc_status = 'verified'
        AND c.age_verified = true
    ) THEN
      RAISE EXCEPTION 'content_publish_guard: creadora % no verificada 18+', NEW.creator_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM content_performers cp WHERE cp.content_id = NEW.id) THEN
      RAISE EXCEPTION 'content_publish_guard: sin performer 2257 vinculado a content %', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
      SELECT 1 FROM content_performers cp
      JOIN performers_2257 p ON p.id = cp.performer_id
      WHERE cp.content_id = NEW.id AND p.is_complete = false
    ) THEN
      RAISE EXCEPTION 'content_publish_guard: registro 2257 incompleto para un performer de content %', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.published_at IS NULL THEN NEW.published_at := now(); END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_publish_guard_trg ON content;
CREATE TRIGGER content_publish_guard_trg
  BEFORE INSERT OR UPDATE ON content
  FOR EACH ROW EXECUTE FUNCTION public.content_publish_guard();

-- ══════════════════════════════════════════════════════════════════════════
-- GATE · creators_guard_privileged — la creadora NO puede auto-verificarse.
-- kyc_status/age_verified/payout_kyc_status/sanctions_status solo los cambia
-- admin o service-role (Didit/screening). Para el resto se coaccionan a OLD.
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.creators_guard_privileged()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_admin() OR public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.kyc_status        := 'unverified';
    NEW.age_verified      := false;
    NEW.age_verified_at   := NULL;
    NEW.payout_kyc_status := 'none';
    NEW.sanctions_status  := 'unscreened';
  ELSE
    NEW.kyc_status        := OLD.kyc_status;
    NEW.age_verified      := OLD.age_verified;
    NEW.age_verified_at   := OLD.age_verified_at;
    NEW.payout_kyc_status := OLD.payout_kyc_status;
    NEW.sanctions_status  := OLD.sanctions_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS creators_guard_privileged_trg ON creators;
CREATE TRIGGER creators_guard_privileged_trg
  BEFORE INSERT OR UPDATE ON creators
  FOR EACH ROW EXECUTE FUNCTION public.creators_guard_privileged();

-- ══════════════════════════════════════════════════════════════════════════
-- GATE · performers_2257_guard — la creadora NO puede auto-certificar un
-- performer como completo/dob-verificado. is_complete/dob_verified solo
-- admin/service-role. El resto de campos sí los edita quien lo cargó.
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.performers_2257_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_admin() OR public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.is_complete  := false;
    NEW.dob_verified := false;
  ELSE
    NEW.is_complete  := OLD.is_complete;
    NEW.dob_verified := OLD.dob_verified;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS performers_2257_guard_trg ON performers_2257;
CREATE TRIGGER performers_2257_guard_trg
  BEFORE INSERT OR UPDATE ON performers_2257
  FOR EACH ROW EXECUTE FUNCTION public.performers_2257_guard();

-- ══════════════════════════════════════════════════════════════════════════
-- GATE · credit_ledger inmutable (append-only). Sin UPDATE/DELETE para nadie
-- (un ledger doble-entrada no se edita: se compensa con un asiento nuevo).
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.credit_ledger_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger es append-only: % no permitido', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS credit_ledger_no_update ON credit_ledger;
CREATE TRIGGER credit_ledger_no_update BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.credit_ledger_immutable();

-- ══════════════════════════════════════════════════════════════════════════
-- GATE · payouts_guard — no se puede marcar 'sent' sin KYC de payout + sanciones
-- 'clear' + Travel Rule ref. Refuerza la pata regulada a nivel DB (PR-8).
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.payouts_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'sent' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'sent') THEN
    IF NEW.travel_rule_ref IS NULL THEN
      RAISE EXCEPTION 'payouts_guard: falta Travel Rule ref' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM creators c
      WHERE c.user_id = NEW.creator_id
        AND c.payout_kyc_status = 'verified'
        AND c.sanctions_status = 'clear'
    ) THEN
      RAISE EXCEPTION 'payouts_guard: creadora % sin payout-KYC verificado o sanciones no clear', NEW.creator_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payouts_guard_trg ON payouts;
CREATE TRIGGER payouts_guard_trg BEFORE INSERT OR UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION public.payouts_guard();

-- ══════════════════════════════════════════════════════════════════════════
-- RLS · todas las tablas nuevas. Patrón del engine: is_admin() recursion-safe.
-- ══════════════════════════════════════════════════════════════════════════
ALTER TABLE creators             ENABLE ROW LEVEL SECURITY;
ALTER TABLE performers_2257      ENABLE ROW LEVEL SECURITY;
ALTER TABLE content              ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_performers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE age_gate_verifications ENABLE ROW LEVEL SECURITY;

-- creators: dueña + admin (los campos privilegiados los protege el guard)
DROP POLICY IF EXISTS creators_select ON creators;
CREATE POLICY creators_select ON creators FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS creators_insert ON creators;
CREATE POLICY creators_insert ON creators FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS creators_update ON creators;
CREATE POLICY creators_update ON creators FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- performers_2257: quien lo cargó + admin (PII sensible)
DROP POLICY IF EXISTS performers_rw ON performers_2257;
CREATE POLICY performers_rw ON performers_2257 FOR ALL TO authenticated
  USING (added_by = auth.uid() OR public.is_admin())
  WITH CHECK (added_by = auth.uid() OR public.is_admin());

-- content: creadora ve lo suyo; admin todo; el fan ve publicado SOLO con
-- entitlement o suscripción vigente (el paywall a nivel DB).
DROP POLICY IF EXISTS content_select ON content;
CREATE POLICY content_select ON content FOR SELECT
  USING (
    creator_id = auth.uid()
    OR public.is_admin()
    OR (
      status = 'published' AND csam_status = 'pass' AND (
        visibility = 'free_preview'
        OR EXISTS (
          SELECT 1 FROM entitlements e
          WHERE e.fan_id = auth.uid() AND e.content_id = content.id
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
        OR EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.fan_id = auth.uid() AND s.creator_id = content.creator_id
            AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > now())
        )
      )
    )
  );
DROP POLICY IF EXISTS content_insert ON content;
CREATE POLICY content_insert ON content FOR INSERT TO authenticated
  WITH CHECK (creator_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS content_update ON content;
CREATE POLICY content_update ON content FOR UPDATE TO authenticated
  USING (creator_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS content_delete ON content;
CREATE POLICY content_delete ON content FOR DELETE TO authenticated
  USING (creator_id = auth.uid() OR public.is_admin());

-- content_performers: la creadora dueña del content + admin
DROP POLICY IF EXISTS content_performers_rw ON content_performers;
CREATE POLICY content_performers_rw ON content_performers FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM content c WHERE c.id = content_id AND c.creator_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM content c WHERE c.id = content_id AND c.creator_id = auth.uid())
  );

-- subscriptions: el fan lo suyo; la creadora ve sus subs; admin todo
DROP POLICY IF EXISTS subscriptions_select ON subscriptions;
CREATE POLICY subscriptions_select ON subscriptions FOR SELECT TO authenticated
  USING (fan_id = auth.uid() OR creator_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS subscriptions_write ON subscriptions;
CREATE POLICY subscriptions_write ON subscriptions FOR ALL TO authenticated
  USING (fan_id = auth.uid() OR public.is_admin())
  WITH CHECK (fan_id = auth.uid() OR public.is_admin());

-- entitlements: el fan lo suyo; admin todo (las escrituras reales las hace
-- service-role tras un pago/tip; se refuerza en PR-6)
DROP POLICY IF EXISTS entitlements_select ON entitlements;
CREATE POLICY entitlements_select ON entitlements FOR SELECT TO authenticated
  USING (fan_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS entitlements_admin_write ON entitlements;
CREATE POLICY entitlements_admin_write ON entitlements FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- credit_ledger: el usuario ve sus asientos; admin todo. INSERT solo service/admin
-- (la app escribe con service-role); UPDATE/DELETE los bloquea el trigger inmutable.
DROP POLICY IF EXISTS ledger_select ON credit_ledger;
CREATE POLICY ledger_select ON credit_ledger FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS ledger_admin_insert ON credit_ledger;
CREATE POLICY ledger_admin_insert ON credit_ledger FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- payouts: la creadora ve los suyos; escritura solo admin/service (guard reforzando)
DROP POLICY IF EXISTS payouts_select ON payouts;
CREATE POLICY payouts_select ON payouts FOR SELECT TO authenticated
  USING (creator_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS payouts_admin_write ON payouts;
CREATE POLICY payouts_admin_write ON payouts FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- age_gate_verifications: el usuario lo suyo; admin todo
DROP POLICY IF EXISTS agegate_select ON age_gate_verifications;
CREATE POLICY agegate_select ON age_gate_verifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS agegate_insert ON age_gate_verifications;
CREATE POLICY agegate_insert ON age_gate_verifications FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- ══════════════════════════════════════════════════════════════════════════
-- Hardening · las funciones de trigger NO deben ser invocables por RPC
-- (PostgREST expone toda función public). Un trigger las corre sin chequear
-- EXECUTE, así que revocar no rompe el gate y cierra la superficie RPC.
-- ══════════════════════════════════════════════════════════════════════════
REVOKE ALL ON FUNCTION public.content_publish_guard()      FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.payouts_guard()              FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.creators_guard_privileged()  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.performers_2257_guard()      FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_ledger_immutable()    FROM public, anon, authenticated;
