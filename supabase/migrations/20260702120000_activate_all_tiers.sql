-- Activate every public tier (Elite / Gold / Silver / Bronze / Basic).
-- Supersedes the Gold+Basic launch policy seeded by
-- 20260626130000_align_admin_schema.sql; keep in sync with
-- DEFAULT_ACTIVE_TIER_SLUGS in src/lib/tier-settings.ts.
INSERT INTO tier_settings (tier_slug, is_active) VALUES
  ('basic', true), ('bronze', true), ('silver', true), ('gold', true), ('elite', true)
ON CONFLICT (tier_slug) DO UPDATE
  SET is_active = EXCLUDED.is_active, updated_at = now();
