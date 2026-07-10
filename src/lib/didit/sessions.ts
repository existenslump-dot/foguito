import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiditDecision } from './types'
import { encryptJson } from './crypto'
import { approveVerification, rejectVerification, type Result } from '@/lib/admin/actions'
import {
  mapStatus,
  isTerminal,
  extractScores,
  extractDeclineReason,
} from './mapping'

/**
 * Persistence + application of a Didit decision (inbound via webhook).
 *
 * - Writes/updates the `verification_sessions` row (service-role): status and
 *   scores in the clear (for the admin queue) + the FULL decision payload
 *   encrypted (AES-256-GCM) — it contains the PII extracted from the document.
 * - Maps the result to `profiles`/`posts` by reusing approveVerification /
 *   rejectVerification (the single write path for the identity_verified flag).
 *
 * Idempotent + out-of-order safe: a late webhook with a NON-terminal status
 * never overwrites an already-terminal session (approved/declined) — it only
 * refreshes metadata. Re-applying approve/reject is idempotent at the DB level.
 */

export type DiditWebhookBody = {
  session_id?: string
  status?: string
  vendor_data?: string | null
  workflow_id?: string | null
  webhook_type?: string | null
  decision?: DiditDecision | null
  [k: string]: unknown
}

export type PersistResult = Result<{
  userId: string | null
  internalStatus: string
  applied: boolean
  stale: boolean
}>

export async function persistDiditDecision(
  admin: SupabaseClient,
  body: DiditWebhookBody,
): Promise<PersistResult> {
  const sessionId = String(body.session_id ?? '').trim()
  if (!sessionId) return { ok: false, error: 'webhook without session_id' }

  const userId = body.vendor_data ? String(body.vendor_data) : null
  const internalStatus = mapStatus(body.status)
  // Scores live in the `decision` sub-object; if it didn't come, fall back to the body.
  const decision = (body.decision ?? body) as DiditDecision
  const { faceMatchScore, livenessScore } = extractScores(decision)
  const declineReason = extractDeclineReason(decision)
  const nowIso = new Date().toISOString()

  // ── Out-of-order guard ────────────────────────────────────────────────
  // If the session is already terminal and a non-terminal webhook arrives, it
  // is an old/late event: refresh metadata but do NOT downgrade the status or
  // re-touch the profile.
  const { data: existing } = await admin
    .from('verification_sessions')
    .select('status')
    .eq('didit_session_id', sessionId)
    .maybeSingle<{ status: string }>()

  const existingTerminal = existing
    ? existing.status === 'approved' || existing.status === 'declined'
    : false
  const stale = existingTerminal && !isTerminal(internalStatus)
  const effectiveStatus = stale && existing ? existing.status : internalStatus

  const { error: upsertErr } = await admin
    .from('verification_sessions')
    .upsert(
      {
        user_id: userId,
        provider: 'didit',
        didit_session_id: sessionId,
        didit_workflow_id: body.workflow_id ?? null,
        status: effectiveStatus,
        decision: body.status ?? null,
        decline_reason: declineReason,
        face_match_score: faceMatchScore,
        liveness_score: livenessScore,
        decision_payload_encrypted: encryptJson(body),
        last_webhook_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'didit_session_id' },
    )
  if (upsertErr) return { ok: false, error: upsertErr.message }

  // ── Apply to the profile ──────────────────────────────────────────────
  if (stale || !userId) {
    return { ok: true, data: { userId, internalStatus, applied: false, stale } }
  }

  if (internalStatus === 'approved') {
    const r = await approveVerification(admin, userId)
    if (!r.ok) return r
  } else if (internalStatus === 'declined') {
    const reason = declineReason ? `Didit: ${declineReason}` : 'Verification declined by Didit'
    const r = await rejectVerification(admin, userId, reason)
    if (!r.ok) return r
  } else if (internalStatus === 'in_review') {
    // Falls into the admin's manual queue (AdminVerifications filters by 'pending').
    const r = await markProfilePending(admin, userId)
    if (!r.ok) return r
  }
  // in_progress / created / abandoned / expired → no profile change.

  return {
    ok: true,
    data: {
      userId,
      internalStatus,
      applied:
        internalStatus === 'approved' ||
        internalStatus === 'declined' ||
        internalStatus === 'in_review',
      stale: false,
    },
  }
}

async function markProfilePending(
  admin: SupabaseClient,
  userId: string,
): Promise<Result> {
  const { data, error } = await admin
    .from('profiles')
    .update({ verification_status: 'pending' })
    .eq('id', userId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) {
    return { ok: false, error: 'profile not found to mark pending' }
  }
  return { ok: true, data: undefined }
}
