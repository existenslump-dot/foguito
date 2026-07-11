import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgeResult, AgeReason } from './didit/age'

/**
 * `creators` row helpers — the bridge between a KYC verdict (Didit webhook or
 * the admin manual path) and the platform's publish gate.
 *
 * Pilar #0 lives at the DB. The LIVE publish path is the legacy `posts` table,
 * gated by `posts_publish_guard` (PR-1); the future `content` table is gated by
 * `content_publish_guard`. BOTH require `creators.kyc_status='verified' AND
 * age_verified=true`. The privileged `creators` columns are coerced by
 * `creators_guard_privileged` unless the writer is admin OR service-role — so
 * EVERY write here MUST use the service-role admin client; a plain
 * `authenticated` write would be silently reverted to OLD/defaults.
 */

/** What we mapped + wrote, for fire-and-forget audit at the callsite. */
export type CreatorSyncResult = {
  applied: boolean
  kyc_status: string | null
  age_verified: boolean | null
  reason: AgeReason
}

export type CreatorVerification = {
  kyc_status: string
  age_verified: boolean
}

/**
 * Map a Didit verdict + derived age onto a `creators` upsert (onConflict
 * user_id). Idempotent. Fail-closed: an approved KYC with a missing/invalid DOB
 * lands in `pending` (never `verified`) so nothing publishes until age is
 * confirmed; a positively-under-18 doc is a hard `rejected`.
 *
 * MUST be called with the service-role `admin` client.
 */
export async function syncCreatorFromDidit(
  admin: SupabaseClient,
  userId: string,
  args: { effectiveStatus: string; ageResult: AgeResult; sessionId?: string | null },
): Promise<CreatorSyncResult> {
  const { effectiveStatus, ageResult, sessionId } = args

  let patch: Record<string, unknown> | null = null
  let kyc_status: string | null = null
  let age_verified: boolean | null = null

  if (effectiveStatus === 'approved') {
    if (ageResult.ageVerified) {
      kyc_status = 'verified'
      age_verified = true
      patch = {
        kyc_status,
        age_verified,
        age_verified_at: new Date().toISOString(),
        didit_session_id: sessionId ?? null,
      }
    } else if (ageResult.reason === 'below_18') {
      // Possible minor → hard reject.
      kyc_status = 'rejected'
      age_verified = false
      patch = { kyc_status, age_verified }
    } else {
      // dob_missing | dob_invalid → fail-closed, hold in pending.
      kyc_status = 'pending'
      age_verified = false
      patch = { kyc_status, age_verified }
    }
  } else if (effectiveStatus === 'declined') {
    kyc_status = 'rejected'
    age_verified = false
    patch = { kyc_status, age_verified }
  } else if (effectiveStatus === 'in_review') {
    kyc_status = 'pending'
    patch = { kyc_status }
  }

  if (!patch) {
    // in_progress / created / abandoned / expired / unknown → no-op.
    return { applied: false, kyc_status: null, age_verified: null, reason: ageResult.reason }
  }

  const { error } = await admin
    .from('creators')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })

  if (error) {
    // Non-fatal: the DB gate stays the authority (unverified → cannot publish).
    console.error('[creators] syncCreatorFromDidit upsert failed (non-fatal)', error.message)
    return { applied: false, kyc_status, age_verified, reason: ageResult.reason }
  }
  return { applied: true, kyc_status, age_verified, reason: ageResult.reason }
}

/**
 * Best-effort upsert of a bare `creators` row (user_id, + didit_session_id when
 * provided). Does NOT force kyc_status='verified' — leaves the default
 * ('unverified') or whatever a prior verdict set. Non-fatal by design; used when
 * a Didit session is created so the row exists before the first webhook.
 *
 * MUST be called with the service-role `admin` client.
 */
export async function ensureCreatorRow(
  admin: SupabaseClient,
  userId: string,
  sessionId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const row: Record<string, unknown> = { user_id: userId }
  if (sessionId) row.didit_session_id = sessionId
  const { error } = await admin.from('creators').upsert(row, { onConflict: 'user_id' })
  if (error) {
    console.error('[creators] ensureCreatorRow upsert failed (non-fatal)', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** Read the publish-relevant verification fields of a creator, or null. */
export async function getCreatorVerification(
  client: SupabaseClient,
  userId: string,
): Promise<CreatorVerification | null> {
  const { data, error } = await client
    .from('creators')
    .select('kyc_status, age_verified')
    .eq('user_id', userId)
    .maybeSingle<CreatorVerification>()
  if (error || !data) return null
  return data
}

/**
 * Mirror of the DB publish-guard predicate (`posts_publish_guard` on the live
 * `posts` path; `content_publish_guard` on the future `content` path). The DB is
 * the authority; this is for defense-in-depth UX gating (redirect before the
 * user wastes time).
 */
export function isPublishEligible(
  v: { kyc_status?: string | null; age_verified?: boolean | null } | null | undefined,
): boolean {
  return v?.kyc_status === 'verified' && v?.age_verified === true
}
