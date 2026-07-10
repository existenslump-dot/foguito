// ─────────────────────────────────────────────────────────────────────────────
// KYC provider interface (C3 — Verification add-on, phase-2 minimum scope)
// ─────────────────────────────────────────────────────────────────────────────
//
// The identity-verification flow is an optional, pluggable module. The engine
// talks to a `KycProvider` and never to a concrete vendor, so swapping the
// homegrown manual flow for a hosted provider (e.g. Didit) is a config change,
// not a code rewrite.
//
// Built-in provider: `manual` (src/lib/kyc/providers/manual.ts) fronts the
// existing /dashboard/verify upload + admin-review flow. A redirect/SDK +
// webhook provider (Didit) slots in by implementing this interface and
// returning `{ mode: 'redirect' }` / `{ mode: 'sdk' }` from startVerification
// plus a `handleCallback` for the inbound webhook.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical verification status, normalized across providers. The manual flow
 * stores these (minus the `unverified` default) in `profiles.verification_status`
 * as 'pending' | 'approved' | 'rejected'; absence/`unverified` means the user
 * never started.
 */
export type KycStatus = 'unverified' | 'pending' | 'approved' | 'rejected'

/**
 * What `startVerification` tells the caller to do next:
 *   - `internal`  → use the built-in in-app upload flow (/dashboard/verify).
 *   - `redirect`  → send the user to the provider's hosted page (`url`).
 *   - `sdk`       → mount the provider's client SDK with `sessionToken`.
 */
export type KycStartResult =
  | { mode: 'internal' }
  | { mode: 'redirect'; url: string }
  | { mode: 'sdk'; sessionToken: string }

export interface KycStartInput {
  userId: string
  /** BCP-47 locale so hosted providers render in the user's language. */
  locale?: string
}

/**
 * Inbound webhook payload, vendor-agnostic. The route handler reads the raw
 * body (signature verification needs the exact bytes) and headers, then hands
 * them to the provider for parsing/verification.
 */
export interface KycCallbackRequest {
  rawBody: string
  headers: Record<string, string | null>
}

export interface KycCallbackResult {
  userId: string
  status: KycStatus
  /** The raw provider payload, kept for audit/debugging. */
  raw: unknown
}

export interface KycProvider {
  /** Stable identifier, e.g. 'manual' | 'didit'. */
  name: string

  /**
   * Begin a verification for `userId`. The return discriminant tells the
   * caller how to proceed (in-app flow vs. redirect vs. embedded SDK).
   */
  startVerification(input: KycStartInput): Promise<KycStartResult>

  /** Current normalized status for a user. */
  getStatus(userId: string): Promise<KycStatus>

  /**
   * Webhook-driven providers (Didit etc.) implement this to verify + parse an
   * inbound callback. Returns `null` when the payload isn't actionable (e.g. a
   * status we don't map). Omitted entirely by providers that don't use
   * webhooks (the manual flow).
   */
  handleCallback?(req: KycCallbackRequest): Promise<KycCallbackResult | null>
}
