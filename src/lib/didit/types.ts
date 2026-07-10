/**
 * Types for the Didit KYC integration.
 *
 * They cover session creation and the decision object. Didit's decision shape
 * is broad and varies by webhook version, so these interfaces are permissive
 * (known fields + an index signature); the defensive extraction lives in the
 * webhook handler, not here.
 *
 * Docs: https://docs.didit.me/reference/api-full-flow
 */

/** Statuses Didit returns (the `status` field). */
export type DiditSessionStatus =
  | 'Not Started'
  | 'In Progress'
  | 'In Review'
  | 'Approved'
  | 'Declined'
  | 'Abandoned'
  | 'Expired'
  | 'Resubmitted'

/** Internal status persisted in `verification_sessions.status`. */
export type VerificationSessionStatus =
  | 'created'
  | 'in_progress'
  | 'in_review'
  | 'approved'
  | 'declined'
  | 'abandoned'
  | 'expired'

/** Parameters to create a verification session. */
export interface DiditCreateSessionParams {
  /** Internal user identifier (recovered in the webhook via `vendor_data`). */
  vendorData: string
  /** Return URL after the hosted flow is completed/abandoned. */
  callback?: string
  /** Hosted UI language (ISO 639-1). Defaults to 'en'. */
  language?: string
  /** Arbitrary metadata Didit echoes back verbatim in the webhook. */
  metadata?: Record<string, unknown>
  /** Optional contact pre-fill. */
  contactDetails?: { email?: string; phone?: string }
}

/** Response of POST /v3/session/. */
export interface DiditSession {
  session_id: string
  session_number?: number
  session_token?: string
  /** Hosted URL the user is redirected to. */
  url: string
  status: DiditSessionStatus
  workflow_id: string
}

/** Sub-object holding the data extracted from the document (PII). */
export interface DiditIdVerification {
  first_name?: string | null
  last_name?: string | null
  date_of_birth?: string | null
  document_type?: string | null
  document_number?: string | null
  issuing_country?: string | null
  expiry_date?: string | null
  [k: string]: unknown
}

export interface DiditScoreCheck {
  status?: string | null
  score?: number | null
  [k: string]: unknown
}

/**
 * Full decision (GET /v3/session/{id}/decision/ or the webhook's `decision`
 * object). Permissive on purpose — the shape differs across webhook versions
 * (`id_verification` vs `id_verifications[]`); normalization is the consumer's
 * responsibility.
 */
export interface DiditDecision {
  session_id?: string
  status?: DiditSessionStatus
  vendor_data?: string | null
  workflow_id?: string | null
  id_verification?: DiditIdVerification | null
  id_verifications?: DiditIdVerification[] | null
  liveness?: DiditScoreCheck | null
  liveness_checks?: DiditScoreCheck[] | null
  face_match?: DiditScoreCheck | null
  face_matches?: DiditScoreCheck[] | null
  warnings?: Array<Record<string, unknown>> | null
  [k: string]: unknown
}

/** Result of a Didit client call (repo's discriminated Result style). */
export type DiditResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number }
