-- ══════════════════════════════════════════════════════════════════════════
-- Dead-flag cleanup + expiry audit
--
--   • `posts.notified_7d` / `notified_15d`: dead columns — the reminder cron
--     uses the 5d/1d intervals (notified_5d/notified_1d) and nothing in the
--     code ever read or wrote the 7d/15d ones. Dropped here (also removed
--     from init for fresh deploys).
--   • `posts.expiry_audited`: cron bookkeeping flag (same pattern as
--     notified_5d/1d). The cron records ONE `post_expired` event in
--     audit_log when a listing crosses its expiry, and marks the row so the
--     event isn't duplicated on later runs.
--   • Trigger `posts_rearm_expiry_audit`: when expires_at is EXTENDED into
--     the future (self-serve/admin/Elite renewal, resume from pause), the
--     flag re-arms itself — the next expiry is audited again without each
--     renewal path having to remember to reset it.
--
-- Idempotent: re-applying this migration is a no-op.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE posts DROP COLUMN IF EXISTS notified_7d;
ALTER TABLE posts DROP COLUMN IF EXISTS notified_15d;

ALTER TABLE posts ADD COLUMN IF NOT EXISTS expiry_audited BOOLEAN NOT NULL DEFAULT false;

-- Daily cron scan: only published, expired and not-yet-audited rows.
CREATE INDEX IF NOT EXISTS idx_posts_expiry_unaudited
  ON posts (expires_at)
  WHERE status = 'published' AND expiry_audited = false;

-- Auto re-arm when validity is extended. IS DISTINCT FROM + "into the
-- future": an update that doesn't touch expires_at (or shortens it) doesn't re-arm.
CREATE OR REPLACE FUNCTION rearm_expiry_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at
     AND NEW.expires_at IS NOT NULL
     AND NEW.expires_at > now()
  THEN
    NEW.expiry_audited := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_rearm_expiry_audit ON posts;
CREATE TRIGGER posts_rearm_expiry_audit
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION rearm_expiry_audit();
