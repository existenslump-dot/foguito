/**
 * Jurisdiction → age-requirement matrix for the consumer (fan) age-gate.
 *
 * PURE + edge-safe (no imports) so the middleware, server components and API
 * routes all share ONE authoritative mapping. Given the VIEWER's location
 * (from src/lib/age-gate/viewer-geo.ts) it decides how hard the gate must be.
 *
 * Levels (strictest → laxest):
 *   - `verify_required` → a REAL identity/age verification (Didit/Yoti). NEVER a
 *     checkbox or a self-declared birthdate. The gate trusts only a
 *     server-authoritative `age_gate_verifications` row written by the webhook.
 *   - `age_gate`        → a serious gate is still mandatory. In this codebase we
 *     satisfy it with the SAME provider flow (reinforced, no trivial checkbox);
 *     the level exists so the copy/UX can differ and so a future lighter method
 *     could be slotted in for these jurisdictions only.
 *   - `none`            → no gate. NOT returned by the default matrix below (see
 *     DEFAULT_REQUIREMENT); kept as a first-class value so the page/gate handle
 *     it defensively and an explicit allowlist could opt a jurisdiction out.
 *
 * ⚠️ FAIL-CLOSED default (`DEFAULT_REQUIREMENT`): anything we can't positively
 * place into a laxer bucket — unknown/unlocated country, indeterminate US state
 * — falls to the STRICTEST level (`verify_required`). Over-enforcement is the
 * safe direction for a CSAM/2257-adjacent adult platform (pilar #0): the cost of
 * being too strict is friction; the cost of being too lax is unlawful exposure.
 * Flip the constant only with counsel sign-off.
 *
 * ⚠️ The US state list and EU set are a best-effort compliance SNAPSHOT (2025),
 * intentionally OVER-inclusive (a state wrongly marked strict just adds
 * friction). Review with counsel; laws change frequently. States NOT listed
 * still get `age_gate` (never 'none'), and an unlocated US viewer gets the
 * strictest level.
 */

export type AgeRequirement = 'verify_required' | 'age_gate' | 'none'

/**
 * Fail-closed default for any jurisdiction we can't positively bucket. The
 * strictest level. Documented, single knob — do not scatter defaults.
 */
export const DEFAULT_REQUIREMENT: AgeRequirement = 'verify_required'

/**
 * US states with adult-content age-verification statutes (postal codes).
 * Best-effort 2025 snapshot — over-inclusive by design (fail-closed). Only
 * consulted when the viewer's country is "US". 25 entries.
 */
export const US_AGE_VERIFICATION_STATES: ReadonlySet<string> = new Set([
  'AL', 'AR', 'AZ', 'FL', 'GA', 'ID', 'IN', 'KS', 'KY', 'LA',
  'MS', 'MO', 'MT', 'NC', 'ND', 'NE', 'OH', 'OK', 'SC', 'SD',
  'TN', 'TX', 'UT', 'VA', 'WY',
])

/**
 * EU/EEA (+ Switzerland) member states — mapped to `age_gate`. These regimes
 * (GDPR-adjacent, national online-safety rules) require a serious gate but not
 * necessarily full identity verification of every viewer. ISO 3166-1 alpha-2.
 * NB: "MT" here is Malta (a country); Montana is only ever matched as a US
 * *region*, so there is no collision.
 */
export const EU_EEA_COUNTRIES: ReadonlySet<string> = new Set([
  // EU-27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // EEA (non-EU) + Switzerland
  'IS', 'LI', 'NO', 'CH',
])

/**
 * Requirement for a viewer's country + (optional) region.
 *
 *   - null/blank country          → DEFAULT_REQUIREMENT (fail-closed).
 *   - BR (ECA Digital), GB/UK     → verify_required.
 *   - US + strict state           → verify_required.
 *   - US + indeterminate state    → verify_required (strictest for unknown US).
 *   - US + other state            → age_gate.
 *   - EU/EEA/CH                    → age_gate.
 *   - anything else               → DEFAULT_REQUIREMENT (fail-closed).
 */
export function requirementFor(
  country: string | null | undefined,
  region: string | null | undefined,
): AgeRequirement {
  const c = typeof country === 'string' ? country.trim().toUpperCase() : ''
  if (!c) return DEFAULT_REQUIREMENT

  // Brazil (ECA Digital / ECA Digital age-verification duty) and the UK (Online
  // Safety Act highly-effective age assurance) require real verification.
  if (c === 'BR') return 'verify_required'
  if (c === 'GB' || c === 'UK') return 'verify_required'

  if (c === 'US') {
    const r = typeof region === 'string' ? region.trim().toUpperCase() : ''
    // Indeterminate US state → strictest. We cannot know the viewer isn't in a
    // state that mandates verification, so we must assume they are.
    if (!r) return 'verify_required'
    return US_AGE_VERIFICATION_STATES.has(r) ? 'verify_required' : 'age_gate'
  }

  if (EU_EEA_COUNTRIES.has(c)) return 'age_gate'

  // Any other located country: fail-closed to the strictest level.
  return DEFAULT_REQUIREMENT
}

/** Numeric rank so requirements can be compared ("at least as strict as"). */
export function requirementRank(requirement: AgeRequirement): number {
  switch (requirement) {
    case 'verify_required':
      return 2
    case 'age_gate':
      return 1
    case 'none':
      return 0
  }
}

/**
 * Canonical, stable string key for a viewer's jurisdiction. This is what gets
 * persisted in `age_gate_verifications.jurisdiction` and matched at gate time,
 * so start-time and check-time MUST agree. Format:
 *   - unlocated              → "ZZ"
 *   - US with a region       → "US-TX"
 *   - US without a region    → "US"
 *   - any other country      → the country code ("BR", "DE", …)
 */
export function jurisdictionKey(
  country: string | null | undefined,
  region: string | null | undefined,
): string {
  const c = typeof country === 'string' ? country.trim().toUpperCase() : ''
  if (!c) return 'ZZ'
  if (c === 'US') {
    const r = typeof region === 'string' ? region.trim().toUpperCase() : ''
    return r ? `US-${r}` : 'US'
  }
  return c
}

/**
 * Requirement implied by a stored jurisdiction KEY (inverse of jurisdictionKey).
 * Used by hasValidVerification to compare a stored verification's regime against
 * the viewer's current one.
 */
export function requirementForKey(key: string | null | undefined): AgeRequirement {
  const k = typeof key === 'string' ? key.trim().toUpperCase() : ''
  if (!k || k === 'ZZ') return DEFAULT_REQUIREMENT
  if (k === 'US') return requirementFor('US', null)
  if (k.startsWith('US-')) return requirementFor('US', k.slice(3))
  return requirementFor(k, null)
}
