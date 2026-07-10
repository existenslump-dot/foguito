-- ══════════════════════════════════════════════════════════════════════════
-- verification_sessions — record of KYC verification sessions with the external
-- provider (Didit). Part of the Verification add-on (KYC_PROVIDER=didit).
--
-- Data custody (design choice — see docs/VERIFICATION-ADDON.md):
--   · The RAW images (ID document / selfie / liveness video) are held by DIDIT,
--     not this app. The user uploads them directly into the provider's hosted
--     flow.
--   · Here we store ONLY operational metadata (status/scores in the clear, so
--     the admin can sort/filter) + the FULL decision payload encrypted in the
--     app with AES-256-GCM (`decision_payload_encrypted`). That blob contains
--     extracted PII (name, document number, date of birth) — hence it is
--     encrypted and the table is RLS deny-all (only the service role reads it).
--
-- Idempotent (CREATE … IF NOT EXISTS / DROP POLICY IF EXISTS) so the file can be
-- re-run safely. Do NOT apply to production without confirmation (there is no
-- migration CI — `supabase db push` is manual).
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS verification_sessions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Provider + external identifiers
  provider                    TEXT NOT NULL DEFAULT 'didit',
  didit_session_id            TEXT UNIQUE,            -- session_id returned by Didit
  didit_workflow_id           TEXT,                   -- workflow used (ID + liveness + face match)

  -- Operational status (in the clear — NOT PII; powers the admin queue)
  --   created / in_progress / in_review / approved / declined / abandoned / expired
  status                      TEXT NOT NULL DEFAULT 'created',
  decision                    TEXT,                   -- raw final Didit status (Approved/Declined/…)
  decline_reason              TEXT,                   -- short non-PII code if declined (e.g. FACE_MISMATCH)
  face_match_score            NUMERIC,                -- 0–100, so the admin can filter dubious matches
  liveness_score              NUMERIC,                -- 0–100

  -- FULL decision payload, encrypted in the app (AES-256-GCM, versioned envelope
  -- `v1.<iv>.<tag>.<ct>`). Contains the PII extracted from the document.
  decision_payload_encrypted  TEXT,

  last_webhook_at             TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "the user's latest session" + per-user lookups
CREATE INDEX IF NOT EXISTS verification_sessions_user_id_idx
  ON verification_sessions (user_id, created_at DESC);

-- ── RLS: deny-all (only the service role, which bypasses RLS) ────────────────
-- We create no permissive policy: with RLS enabled and no policies, anon and
-- authenticated can read/write NOTHING. The admin accesses it via an API route
-- with the service role (same pattern as /api/admin/identity-doc). FORCE so the
-- lockdown applies to the table owner too.
ALTER TABLE verification_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_sessions FORCE ROW LEVEL SECURITY;

-- Defensive: if a previous run left policies behind, clean them up.
DROP POLICY IF EXISTS "verification_sessions_no_access" ON verification_sessions;

COMMENT ON TABLE verification_sessions IS
  'KYC sessions with an external provider (Didit). RLS deny-all: service-role only. Raw images held by the provider; here only metadata + encrypted decision.';
