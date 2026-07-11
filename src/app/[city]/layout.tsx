import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { isCrawler } from '@/lib/crawler'
import { getViewerJurisdiction } from '@/lib/age-gate/viewer-geo'
import { requirementFor, jurisdictionKey } from '@/lib/age-gate/jurisdictions'
import { hasValidVerification } from '@/lib/age-gate/status'

/**
 * CONSUMER AGE-GATE (PILAR #0 — bloqueante) over the content-viewing surface.
 *
 * This layout wraps EVERY route under `/[city]` — the city feed and the
 * `/{slug}` / `/[city]/post/[id]` detail views, which are where a fan actually
 * consumes creator content. It is the server-side entry gate: a viewer whose
 * jurisdiction demands age assurance cannot render any of it without a valid,
 * server-authoritative verification.
 *
 * NB: the paywalled creator-content surface proper (subscriptions/entitlements)
 * lands in PR-5. It will live under this same `/[city]` tree (or a sibling that
 * re-uses this gate), so it ships ALREADY behind the age-gate — do not add a
 * content-viewing route that bypasses this layout.
 *
 * Rules (all repeated as invariants across the age-gate modules):
 *   - Follow the VIEWER, from Vercel geo headers (getViewerJurisdiction) — never
 *     the URL-path geo (src/lib/geo.ts).
 *   - FAIL-CLOSED: an unknown/unlocated viewer resolves to the strictest
 *     requirement (requirementFor → verify_required), never 'none'.
 *   - Where verification is required, trust ONLY `age_gate_verifications`
 *     (written by the service-role webhook). NEVER a cookie/checkbox.
 *   - Bots are exempt (same allowlist as the middleware geo-block) so crawlers
 *     can still index — they can't verify age and would otherwise see nothing.
 */
export default async function CityAgeGateLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const h = await headers()

  // Bots: exempt (crawlers can't verify; gating them would deindex the site).
  if (isCrawler(h.get('user-agent') ?? '')) return <>{children}</>

  const viewer = getViewerJurisdiction(h)
  const requirement = requirementFor(viewer.country, viewer.region)

  // 'none' → no gate for this jurisdiction (not returned by the default matrix,
  // handled defensively). verify_required / age_gate both need a real row.
  if (requirement === 'none') return <>{children}</>

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const key = jurisdictionKey(viewer.country, viewer.region)

  // Not logged in, or no valid verification for this regime → send to the gate.
  // (An anonymous viewer can't hold a verification row — the row is keyed to a
  // user — so they must sign in and verify. Fail-closed by construction.)
  if (!user || !(await hasValidVerification(supabase, user.id, key))) {
    redirect('/verificar-edad')
  }

  return <>{children}</>
}
