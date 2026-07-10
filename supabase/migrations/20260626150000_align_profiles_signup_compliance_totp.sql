-- ─────────────────────────────────────────────────────────────────────────
-- Align profiles with the signup-finalization and TOTP code.
--
-- finalize-signup (src/app/api/auth/finalize-signup/route.ts) runs on EVERY
-- signup and does an UNGATED .select()/.update() of consent columns that
-- init.sql never created. The missing columns made the route return HTTP 500
-- on every signup — the error is caught and swallowed (registro/page.tsx),
-- so users still proceed but the terms/privacy consent audit trail was never
-- persisted. The TOTP (2FA) routes have the same drift.
--
-- All additive + nullable (except totp_enabled, which the code reads as a
-- boolean flag) and idempotent.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  -- universal consent audit (written on every signup / at KYC submit)
  ADD COLUMN IF NOT EXISTS terms_accepted_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_accepted_ip             TEXT,
  ADD COLUMN IF NOT EXISTS kyc_submitted_ip              TEXT,
  -- TOTP / 2FA (src/app/api/auth/totp/*)
  ADD COLUMN IF NOT EXISTS totp_secret           TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_recovery_codes   TEXT[],
  ADD COLUMN IF NOT EXISTS last_totp_verified_at TIMESTAMPTZ;
