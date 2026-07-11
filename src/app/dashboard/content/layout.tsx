import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { kycEnabled } from '@/lib/kyc'
import { getCreatorVerification, isPublishEligible } from '@/lib/creators'

/**
 * Gate for /dashboard/content (the creator's content surface).
 *
 * Layers:
 *   1. auth (must be logged in)
 *   2. KYC 18+ gate (Pilar #0) — when KYC is enabled, a creator that is not
 *      publish-eligible (creators.kyc_status='verified' AND age_verified=true)
 *      is bounced to /dashboard/verify.
 *
 * NB: the AUTHORITY is at the DB. `content_publish_guard` blocks publishing any
 * `content` unless the creator is verified 18+, every performer's 2257 record is
 * complete, and CSAM passed — even for service-role/admin writes. This layout is
 * defense-in-depth UX, redirecting early so the creator doesn't fill a form only
 * to be blocked. We read her OWN row through the RLS-scoped anon+cookie client
 * (creators_select allows user_id = auth.uid()), no service-role needed.
 *
 * (Unlike /dashboard/create there is NO "1 active post" rule — a creator can
 * upload many pieces of content.)
 */
export default async function DashboardContentLayout({
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
  if (!user) redirect('/ingresar?redirect=/dashboard/content')

  if (kycEnabled()) {
    const verification = await getCreatorVerification(supabase, user.id)
    if (!isPublishEligible(verification)) {
      redirect('/dashboard/verify')
    }
  }

  return <>{children}</>
}
