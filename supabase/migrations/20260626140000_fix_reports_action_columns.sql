-- ─────────────────────────────────────────────────────────────────────────
-- Correct the reports moderation schema introduced in 20260626130000.
--
-- That migration added reports.status with CHECK ('pending','resolved',
-- 'dismissed'), but the admin code (src/lib/admin/actions.ts) actually
-- writes status='actioned' and three tracking columns that were never
-- created. As written, actionReport() / dismissReport(opts) /
-- deletePostFromReport(opts) would fail with a CHECK violation or
-- "column does not exist".
--
-- Idempotent: safe whether the DB has the buggy 130000 state or a fresh
-- correct one.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_status_check;
ALTER TABLE reports ADD CONSTRAINT reports_status_check
  CHECK (status IN ('pending','actioned','dismissed'));

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS actioned_by_admin_id UUID,
  ADD COLUMN IF NOT EXISTS actioned_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_note           TEXT;
