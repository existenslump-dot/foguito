import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { kycEnabled } from '@/lib/kyc'
import { getCreatorVerification, isPublishEligible } from '@/lib/creators'

/**
 * Self-service gate for /dashboard/create.
 *
 * Layers:
 *   1. auth (must be logged in)
 *   2. KYC 18+ gate (Pilar #0) — when KYC is enabled, a creator that is not
 *      publish-eligible (creators.kyc_status='verified' AND age_verified=true)
 *      is bounced to /dashboard/verify.
 *   3. 1-active-post rule.
 *
 * NB: the AUTHORITY is at the DB. The LIVE publish path is the legacy `posts`
 * table, gated by `posts_publish_guard` (PR-1) — nothing reaches
 * status='published'/is_approved without a verified 18+ creator, even for
 * service-role/admin writes. (`content_publish_guard` guards the future
 * `content` table, which the product migrates to in PR-5.) This layout gate is
 * defense-in-depth UX — it redirects early so the user doesn't fill a form only
 * to be blocked at publish. We read the creator's OWN row through the RLS-scoped
 * anon+cookie client (creators_select allows user_id = auth.uid()), no
 * service-role needed.
 */
export default async function DashboardCreateLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/ingresar?redirect=/dashboard/create')

  if (kycEnabled()) {
    const verification = await getCreatorVerification(supabase, user.id)
    if (!isPublishEligible(verification)) {
      redirect('/dashboard/verify')
    }
  }

  const { data: activePosts } = await supabase
    .from('posts')
    .select('id')
    .eq('user_id', user.id)
    .in('status', ['pending', 'published'])
    .limit(1)
  if (activePosts && activePosts.length > 0) {
    redirect('/dashboard?reason=already_has_post')
  }

  return <>{children}</>
}
