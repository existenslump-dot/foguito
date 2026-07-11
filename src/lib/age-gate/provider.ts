// ─────────────────────────────────────────────────────────────────────────────
// Consumer age-verification provider interface (PILAR #0 — viewer age-gate).
// ─────────────────────────────────────────────────────────────────────────────
//
// Age assurance of the VIEWER is a capability of an ESTABLISHED VENDOR (Didit
// age-estimation, Yoti, …) — never built from scratch. The engine talks to this
// `AgeVerifyProvider` interface, never to a concrete vendor, so wiring the real
// provider (adapter + credentials) is a config change, not a rewrite. Same
// pattern as src/lib/csam/provider.ts and src/lib/kyc/provider.ts.
//
// Built-in provider: `stub` (src/lib/age-gate/providers/stub.ts) —
// DETERMINISTIC, NO NETWORK, SOLO scaffolding. The real vendor lives in
// providers/didit.ts behind `isAgeVerifyEnabled()`.
//
// INVARIANTE (pilar #0): the gate trusts ONLY a server-authoritative
// `age_gate_verifications` row, and that row is written ONLY by the webhook
// (service-role) after the provider returns a positive ≥18 result. A provider
// never writes the row itself; startVerification only kicks off the hosted flow.
// ─────────────────────────────────────────────────────────────────────────────

/** Input to start a hosted verification for a specific viewer. */
export interface AgeVerifyStartInput {
  /** The fan's user id (bound to the session in the API route, never the body). */
  userId: string
  /**
   * Canonical jurisdiction key of the VIEWER at start time (jurisdictionForKey
   * format, e.g. "US-TX" / "BR" / "ZZ"). Captured now so the webhook can scope
   * the resulting verification to the regime that required it.
   */
  jurisdiction: string
  /** URL the hosted flow returns to once the viewer finishes/abandons. */
  callbackUrl: string
}

/**
 * Normalized verification outcome, vendor-agnostic. Produced by the webhook from
 * the provider's decision; NEVER carries DOB/name/document (PII minimization —
 * only the ≥18 verdict + jurisdiction + timing are ever persisted).
 */
export interface AgeVerifyResult {
  /** True only when the provider positively proved the viewer is ≥18. */
  verified: boolean
  /** Stable method identifier of the vendor ('didit', 'yoti', …). Never 'self_declared'. */
  method: string
  /** Canonical jurisdiction key the verification was performed for. */
  jurisdiction: string
  /** ISO timestamp when the verification lapses (re-verify after this). */
  expiresAt?: string
}

export interface AgeVerifyProvider {
  /** Stable identifier, e.g. 'stub' | 'didit'. */
  name: string

  /**
   * Start a hosted verification and return the URL to send the viewer to.
   * MUST be fail-closed: without credentials it throws (the caller surfaces a
   * 503/502) — it never returns a fake "verified" URL.
   */
  startVerification(input: AgeVerifyStartInput): Promise<{ url: string }>
}
