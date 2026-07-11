import 'server-only'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getViewerJurisdiction, type HeadersLike } from './viewer-geo'
import { requirementFor, jurisdictionKey } from './jurisdictions'
import { hasValidVerification } from './status'

/**
 * SHARED consumer age-gate enforcement (PILAR #0 — bloqueante).
 *
 * This is the ONE server-side entry point every content-viewing route must go
 * through. Extracted from the `/[city]` layout so it can wrap *every* surface
 * where a fan consumes creator content — not just the city tree. Any layout that
 * fronts creator content calls this; a route that renders content without a
 * gating ancestor layout is a coverage hole (see coverage.test.ts).
 *
 * Behaviour:
 *   1. Resolve the VIEWER's jurisdiction from Vercel geo headers
 *      (getViewerJurisdiction) — never the URL-path geo (src/lib/geo.ts).
 *   2. requirementFor() → FAIL-CLOSED: an unknown/unlocated viewer resolves to
 *      the STRICTEST requirement, never 'none'.
 *   3. Where a requirement applies, trust ONLY a server-authoritative
 *      `age_gate_verifications` row (hasValidVerification) — never a cookie or
 *      checkbox. No logged-in user, or no qualifying row ⇒ redirect to the gate.
 *
 * ⚠️ NO BOT/UA EXEMPTION. Unlike the middleware geo-block, the age-gate does NOT
 * exempt crawlers by User-Agent: a UA string is trivially forgeable, so exempting
 * `Googlebot`/`whatsapp`/etc. would be a one-header bypass of the whole gate. The
 * gated creator-content surface is INTENTIONALLY not crawlable — that is the
 * correct posture for adult content (it should not be indexed anyway). The SFW,
 * indexable landing/`/verificar-edad` pages live OUTSIDE this gate, so search
 * engines still have something to crawl.
 *
 * `redirect()` throws NEXT_REDIRECT, so on the reject path this never returns.
 */
export async function enforceAgeGateOrRedirect(
  supabase: SupabaseClient,
  headers: HeadersLike,
): Promise<void> {
  const viewer = getViewerJurisdiction(headers)
  const requirement = requirementFor(viewer.country, viewer.region)

  // 'none' → no gate for this jurisdiction (never returned by the default
  // fail-closed matrix; handled defensively). Otherwise a real row is required.
  if (requirement === 'none') return

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const key = jurisdictionKey(viewer.country, viewer.region)

  // Not logged in, or no valid verification for this regime → send to the gate.
  // An anonymous viewer can't hold a verification row (it's keyed to a user), so
  // they must sign in and verify. Fail-closed by construction.
  if (!user || !(await hasValidVerification(supabase, user.id, key))) {
    redirect('/verificar-edad')
  }
}
