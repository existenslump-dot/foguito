-- ─────────────────────────────────────────────────────────────────────────
-- Align DB schema with the admin-panel code.
--
-- The application code drifted ahead of the init migration: the admin panel
-- and several libs reference columns/tables that init.sql never created, so
-- the demo DB (and any fresh deploy) threw:
--   · "column reports.status does not exist"
--   · "column audit_log.event_type does not exist"
--   · tier load failure (tier_settings table missing)
--
-- This migration is additive and safe to re-run (IF NOT EXISTS / ON CONFLICT).
-- ─────────────────────────────────────────────────────────────────────────

-- 1. reports.status — moderation workflow (admin filters status = 'pending').
ALTER TABLE reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_status_check') THEN
    ALTER TABLE reports ADD CONSTRAINT reports_status_check
      CHECK (status IN ('pending','resolved','dismissed'));
  END IF;
END $$;

-- 2. audit_log — the codebase has TWO audit writers:
--      · logAudit()   (src/lib/auditLog.ts)  → action / resource / user_id / ip_address  (original schema)
--      · recordAudit() (src/lib/audit.ts)    → event_type / actor_role / actor_user_id / subject_* / ip / user_agent
--    plus the /admin/audit-log page reads the recordAudit() shape. init.sql
--    only created the logAudit() columns. Add the recordAudit() columns so
--    both writers and the reader work. All additive + nullable.
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS actor_user_id UUID,
  ADD COLUMN IF NOT EXISTS actor_role    TEXT,
  ADD COLUMN IF NOT EXISTS event_type    TEXT,
  ADD COLUMN IF NOT EXISTS subject_type  TEXT,
  ADD COLUMN IF NOT EXISTS subject_id    TEXT,
  ADD COLUMN IF NOT EXISTS ip            TEXT,
  ADD COLUMN IF NOT EXISTS user_agent    TEXT;
-- recordAudit() does not set `action`; relax the legacy NOT NULL.
ALTER TABLE audit_log ALTER COLUMN action DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor      ON audit_log (actor_user_id);

-- 3. tier_settings — admin toggle of which tiers are publicly offered
--    (referenced as "migration 20260419010000" in src/lib/tier-settings.ts,
--    which never shipped). Public read, admin write.
CREATE TABLE IF NOT EXISTS tier_settings (
  tier_slug  TEXT PRIMARY KEY,
  is_active  BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tier_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tier_settings_public_read" ON tier_settings;
CREATE POLICY "tier_settings_public_read" ON tier_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "tier_settings_admin_write" ON tier_settings;
CREATE POLICY "tier_settings_admin_write" ON tier_settings FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Launch policy: Gold + Basic active, rest off (matches DEFAULT_ACTIVE_TIER_SLUGS).
INSERT INTO tier_settings (tier_slug, is_active) VALUES
  ('basic', true), ('bronze', false), ('silver', false), ('gold', true), ('elite', false)
ON CONFLICT (tier_slug) DO NOTHING;

-- 4. Re-seed the tiers catalog if empty (FK target for posts.tier_id).
INSERT INTO tiers (id, name, credits, photos, videos, sort_order) VALUES
  ('basic','Basic',49,6,0,1),
  ('bronze','Bronze',99,9,3,2),
  ('silver','Silver',199,12,6,3),
  ('gold','Gold',399,20,12,4),
  ('elite','Elite',599,30,20,5)
ON CONFLICT (id) DO NOTHING;
