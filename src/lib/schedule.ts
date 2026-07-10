/* ── Schedule-based availability helper ──
 *
 * Shared between PostDetailView (big "Disponible / No disponible" chip on
 * the hero) and PostCard (single dot next to the name on the feed card).
 * Both surfaces read the listing's `availability` attribute (a multiselect
 * defined in src/config/attributes.config.ts) so the green-dot state stays
 * consistent between list and detail views.
 *
 * The generic model stores availability as a set of labels rather than a
 * parseable time range, so this helper can only answer the always-on case
 * ("24 horas") with certainty. Any other value is treated as "unknown" and
 * the caller falls back to "available" — matching the previous behaviour for
 * empty/unparseable schedules.
 */

/** Always-available availability label (see attributes.config.ts). */
const ALWAYS_AVAILABLE = '24 horas'

/**
 * Returns `true` when the listing advertises round-the-clock availability,
 * or `null` when availability is unknown/partial (caller decides the default
 * — post detail and feed cards both fall back to "available" today).
 */
export function isWithinSchedule(post: {
  attributes?: Record<string, unknown> | null
}): boolean | null {
  const availability = post.attributes?.availability
  if (Array.isArray(availability) && availability.includes(ALWAYS_AVAILABLE)) {
    return true
  }
  return null
}
