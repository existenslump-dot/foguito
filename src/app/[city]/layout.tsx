import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { enforceAgeGateOrRedirect } from '@/lib/age-gate/enforce'

/**
 * CONSUMER AGE-GATE (PILAR #0 — bloqueante) over the content-viewing surface.
 *
 * This layout wraps EVERY route under `/[city]` — the city feed, the
 * `/{slug}` / `/[city]/post/[id]` detail views and the nested geo/SEO feeds,
 * which are where a fan actually consumes creator content. It is the server-side
 * entry gate: a viewer whose jurisdiction demands age assurance cannot render any
 * of it without a valid, server-authoritative verification.
 *
 * The enforcement itself lives in the shared `enforceAgeGateOrRedirect` helper so
 * the SAME gate can front other content surfaces (e.g. `/perfil/[slug]`) — do not
 * inline the logic here again, and do not add a content-viewing route that
 * bypasses this layout (or an equivalent one calling the same helper).
 *
 * NB: the paywalled creator-content surface proper (subscriptions/entitlements)
 * lands in PR-5. It will live under this same `/[city]` tree (or a sibling that
 * re-uses this gate), so it ships ALREADY behind the age-gate.
 *
 * ⚠️ NO bot/UA exemption here — see enforceAgeGateOrRedirect. The gated adult
 * surface is intentionally non-crawlable; the SFW landing + `/verificar-edad`
 * pages (outside this gate) are what stays indexable.
 */
export default async function CityAgeGateLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const h = await headers()
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )

  await enforceAgeGateOrRedirect(supabase, h)

  return <>{children}</>
}
