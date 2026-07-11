/**
 * Viewer geolocation for the consumer (fan) age-gate — PILAR #0.
 *
 * PURE + edge-safe (no imports, no node:crypto/otpauth) so it can run in the
 * edge middleware AND in server components. It reads Vercel's geo headers,
 * which is the ONLY reliable signal of where the VIEWER actually is:
 *
 *   - `x-vercel-ip-country`         → ISO 3166-1 alpha-2 (e.g. "US", "BR").
 *   - `x-vercel-ip-country-region`  → ISO 3166-2 subdivision WITHOUT the country
 *                                     prefix (e.g. "TX" for Texas, "CA" for
 *                                     California). Only meaningful for the US
 *                                     state-by-state age-verification laws.
 *
 * ⚠️ Do NOT reuse src/lib/geo.ts for this — that module derives geography from
 * the URL PATH (which city/country slug the page is about), NOT from the person
 * looking at the screen. The age-gate must follow the VIEWER, never the content.
 *
 * ⚠️ Next 16 removed `request.geo`; the previous geo-block read it and silently
 * fell back to a constant. These headers are the supported replacement.
 *
 * FAIL-CLOSED: a missing/blank country returns `country: null`. Callers
 * (requirementFor) MUST treat a null country as the STRICTEST requirement, never
 * as 'none'. We deliberately do not invent a default country here — swallowing
 * "unknown" as some allowed country would open the gate for un-located viewers.
 */

/** Minimal shape shared by the Web `Headers` and Next's `ReadonlyHeaders`. */
export interface HeadersLike {
  get(name: string): string | null | undefined
}

export interface ViewerJurisdiction {
  /** ISO 3166-1 alpha-2, uppercased. `null` when Vercel couldn't locate the IP. */
  country: string | null
  /** ISO 3166-2 subdivision (no country prefix), uppercased. `null` if absent. */
  region: string | null
}

/** Uppercased, trimmed header value — `null` for missing/blank. */
function readHeader(headers: HeadersLike, name: string): string | null {
  const raw = headers.get(name)
  if (typeof raw !== 'string') return null
  const value = raw.trim().toUpperCase()
  return value.length > 0 ? value : null
}

/**
 * Resolve the viewer's jurisdiction from the incoming request headers.
 * Deterministic + side-effect free.
 */
export function getViewerJurisdiction(headers: HeadersLike): ViewerJurisdiction {
  return {
    country: readHeader(headers, 'x-vercel-ip-country'),
    region: readHeader(headers, 'x-vercel-ip-country-region'),
  }
}
