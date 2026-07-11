import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { enforceAgeGateOrRedirect } from '@/lib/age-gate/enforce'

/**
 * CONSUMER AGE-GATE (PILAR #0 — bloqueante) over the public creator profile.
 *
 * `/perfil/[slug]` renders a creator's published content (thumbnails grid) to the
 * fan, exactly like the `/[city]` feed — so it must sit behind the SAME gate. It
 * lives outside the `/[city]` tree, so without this layout it rendered creator
 * content to an un-verified viewer in a `verify_required` jurisdiction (the PR-4
 * coverage hole this closes).
 *
 * Reuses the shared `enforceAgeGateOrRedirect` helper (no bot/UA exemption). The
 * page's own `robots: index` only affects the SFW crawler surface; a real viewer
 * still passes the server-side gate here first.
 */
export default async function PerfilAgeGateLayout({
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
