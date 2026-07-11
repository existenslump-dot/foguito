/**
 * Pure 18+ derivation from a document date-of-birth.
 *
 * Pilar #0: sin edad confirmada ≥18 no hay publicación. This module owns the
 * ONLY age computation — it takes the DOB extracted from the Didit decision
 * (`extractIdVerification(decision)?.date_of_birth`) and a caller-supplied
 * `now` (never `Date.now()` internally, so it's deterministic + testable) and
 * returns a fail-closed verdict: anything we can't positively prove ≥18
 * (missing / unparseable / future DOB) is NOT age-verified.
 *
 * Day-precision: someone whose birthday is today counts as having turned that
 * age; the day before their 18th they're still 17.
 */

export type AgeReason = 'ok' | 'below_18' | 'dob_missing' | 'dob_invalid'

/**
 * Strict ISO-8601 date shape: `YYYY-MM-DD`, optionally followed by a time part
 * (`T…` or ` …`). Locale strings ('07/10/2007'), bare years ('2007') and
 * free-text dates ('July 10, 2007') are rejected up front — `new Date()` would
 * parse some of those unpredictably (host-dependent), which is not fail-closed.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/

export type AgeResult = {
  dob: string | null
  age: number | null
  ageVerified: boolean
  reason: AgeReason
}

/** Full years between `dob` and `now`, UTC + day precision (TZ-independent). */
function yearsBetween(dob: Date, now: Date): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  const monthDelta = now.getUTCMonth() - dob.getUTCMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age -= 1
  }
  return age
}

export function deriveAge(
  dateOfBirth: string | null | undefined,
  now: Date,
): AgeResult {
  const raw = typeof dateOfBirth === 'string' ? dateOfBirth.trim() : ''
  if (!raw) {
    return { dob: null, age: null, ageVerified: false, reason: 'dob_missing' }
  }

  // Reject anything that isn't a strict ISO date before touching `new Date()`.
  if (!ISO_DATE_RE.test(raw)) {
    return { dob: null, age: null, ageVerified: false, reason: 'dob_invalid' }
  }

  const dob = new Date(raw)
  if (Number.isNaN(dob.getTime())) {
    return { dob: null, age: null, ageVerified: false, reason: 'dob_invalid' }
  }
  // Round-trip: the parsed instant's UTC date must equal the input's date part.
  // Catches out-of-range values ('2007-13-40') and any silent normalization —
  // if the parse didn't preserve the literal calendar day, we don't trust it.
  if (dob.toISOString().slice(0, 10) !== raw.slice(0, 10)) {
    return { dob: null, age: null, ageVerified: false, reason: 'dob_invalid' }
  }
  // A DOB in the future is nonsense — treat as invalid (fail-closed).
  if (dob.getTime() > now.getTime()) {
    return { dob: null, age: null, ageVerified: false, reason: 'dob_invalid' }
  }

  const age = yearsBetween(dob, now)
  if (age < 18) {
    return { dob: raw, age, ageVerified: false, reason: 'below_18' }
  }
  return { dob: raw, age, ageVerified: true, reason: 'ok' }
}
