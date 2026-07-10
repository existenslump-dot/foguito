import type {
  DiditDecision,
  DiditIdVerification,
  DiditScoreCheck,
  VerificationSessionStatus,
} from './types'

/**
 * Normalization of a Didit decision into our internal model.
 *
 * The decision object's shape differs across webhook versions (`face_match` vs
 * `face_matches[]`, `liveness` vs `liveness_checks[]`, `id_verification` vs
 * `id_verifications[]`), so all extraction is defensive: we try both shapes and
 * return null when absent.
 */

/** Maps Didit's raw `status` to our internal enum. */
export function mapStatus(diditStatus: string | undefined | null): VerificationSessionStatus {
  switch (diditStatus) {
    case 'Approved':
      return 'approved'
    case 'Declined':
      return 'declined'
    case 'In Review':
      return 'in_review'
    case 'In Progress':
      return 'in_progress'
    case 'Abandoned':
      return 'abandoned'
    case 'Expired':
      return 'expired'
    case 'Not Started':
      return 'created'
    case 'Resubmitted':
      // The user redid the verification → back in progress.
      return 'in_progress'
    default:
      // Unknown status: doesn't touch the verified flag, stays in progress.
      return 'in_progress'
  }
}

/** Terminal states (never downgraded by a later out-of-order webhook). */
export function isTerminal(status: VerificationSessionStatus): boolean {
  return status === 'approved' || status === 'declined'
}

function firstCheck(
  single: DiditScoreCheck | null | undefined,
  list: DiditScoreCheck[] | null | undefined,
): DiditScoreCheck | null {
  if (single) return single
  if (Array.isArray(list) && list.length > 0) return list[0]
  return null
}

function numericScore(check: DiditScoreCheck | null): number | null {
  if (!check) return null
  const s = check.score
  return typeof s === 'number' && Number.isFinite(s) ? s : null
}

/** Extracts the face-match and liveness scores (0–100), tolerant of shape. */
export function extractScores(decision: DiditDecision | null | undefined): {
  faceMatchScore: number | null
  livenessScore: number | null
} {
  if (!decision) return { faceMatchScore: null, livenessScore: null }
  return {
    faceMatchScore: numericScore(firstCheck(decision.face_match, decision.face_matches)),
    livenessScore: numericScore(firstCheck(decision.liveness, decision.liveness_checks)),
  }
}

/** Data extracted from the document (PII), tolerant of shape. */
export function extractIdVerification(
  decision: DiditDecision | null | undefined,
): DiditIdVerification | null {
  if (!decision) return null
  if (decision.id_verification) return decision.id_verification
  if (Array.isArray(decision.id_verifications) && decision.id_verifications.length > 0) {
    return decision.id_verifications[0]
  }
  return null
}

/**
 * Short, NON-PII decline reason to show the admin / log. Takes the first
 * warning that looks like a code/label. Never includes document data — the full
 * detail lives in the encrypted payload.
 */
export function extractDeclineReason(
  decision: DiditDecision | null | undefined,
): string | null {
  const warnings = decision?.warnings
  if (!Array.isArray(warnings) || warnings.length === 0) return null
  const first = warnings[0] as Record<string, unknown>
  const candidate =
    first.risk ?? first.code ?? first.type ?? first.reason ?? first.name ?? first.log_type
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim().slice(0, 120)
  }
  return null
}
