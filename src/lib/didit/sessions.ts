import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiditDecision } from './types'
import { encryptJson } from './crypto'
import { approveVerification, rejectVerification, type Result } from '@/lib/admin/actions'
import { recordAudit } from '@/lib/audit'
import { deriveAge } from './age'
import { syncCreatorFromDidit } from '@/lib/creators'
import { ensureSelfPerformerFromDidit } from '@/lib/performers'
import {
  mapStatus,
  isTerminal,
  extractScores,
  extractDeclineReason,
  extractIdVerification,
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

  // skipCreatorMirror: syncCreatorFromDidit (below) is the SOLE owner of the
  // `creators` write on this path — it carries the DOB-derived age. Letting
  // approve/reject also upsert creators would double-write + open a transient
  // window where the row is set without the age verdict.
  if (internalStatus === 'approved') {
    const r = await approveVerification(admin, userId, { skipCreatorMirror: true })
    if (!r.ok) return r
  } else if (internalStatus === 'declined') {
    const reason = declineReason ? `Didit: ${declineReason}` : 'Verification declined by Didit'
    const r = await rejectVerification(admin, userId, reason, { skipCreatorMirror: true })
    if (!r.ok) return r
  } else if (internalStatus === 'in_review') {
    // Falls into the admin's manual queue (AdminVerifications filters by 'pending').
    const r = await markProfilePending(admin, userId)
    if (!r.ok) return r
  }
  // in_progress / created / abandoned / expired → no profile change.

  // ── Sync the creators row (PR-1: explicit 18+ gate) ────────────────────
  // Reached only when !stale && userId (early-returned above). Uses the same
  // service-role `admin` client → passes creators_guard_privileged so
  // kyc_status/age_verified actually persist. The DB content_publish_guard is
  // the real authority; this keeps the creator's verification state in sync so
  // a verified 18+ creator can publish and a minor/undetermined one cannot.
  const idv = extractIdVerification(decision)
  const ageResult = deriveAge(idv?.date_of_birth, new Date())
  const creatorSync = await syncCreatorFromDidit(admin, userId, {
    effectiveStatus,
    ageResult,
    sessionId,
  })
  // Audit only when the gate actually acted (verified/rejected/pending) — this
  // also captures a DB-write failure (kyc_status set, applied=false). Pure
  // no-op statuses (in_progress/created/…) are already covered by the webhook's
  // kyc_didit_* audit, so we don't add noise here.
  if (creatorSync.kyc_status !== null) {
    void recordAudit({
      eventType: `kyc_creator_${creatorSync.kyc_status}`,
      actorRole: 'system',
      actorUserId: userId,
      subjectType: 'creator',
      subjectId: userId,
      metadata: {
        didit_session_id: sessionId,
        effective_status: effectiveStatus,
        // reason only — never the DOB itself (PII lives encrypted in the session).
        age_reason: creatorSync.reason,
        age_verified: creatorSync.age_verified,
        applied: creatorSync.applied,
      },
    })
  }

  // ── Auto-complete the creator's OWN 2257 record (PR-2) ─────────────────
  // Once she's verified 18+ (age_verified — only set on approved + adult DOB),
  // the Didit verdict IS the 2257 certification for her own appearance. Runs on
  // the same service-role `admin` client → passes performers_2257_guard, so
  // is_complete/dob_verified persist. Reached only when !stale && userId (both
  // early-returned above), so a late/out-of-order webhook can't touch it.
  // INVARIANTE #1: this (self, via the Didit verdict) and the admin's
  // completePerformer are the ONLY paths that certify a 2257 record — the
  // creator-facing /api/performers route never does.
  if (creatorSync.applied === true && creatorSync.age_verified === true) {
    // If Didit gave no usable name we still certify the self record with an
    // empty (encrypted) name — the gate only cares about is_complete; the admin
    // can fill the name later.
    const legalName = `${idv?.first_name ?? ''} ${idv?.last_name ?? ''}`.trim()
    const selfRes = await ensureSelfPerformerFromDidit(admin, userId, { legalName, sessionId })
    if (selfRes.ok) {
      void recordAudit({
        eventType: 'performer_self_completed',
        actorRole: 'system',
        actorUserId: userId,
        subjectType: 'performer',
        subjectId: userId,
        metadata: { didit_session_id: sessionId },
      })
    }
  }

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
