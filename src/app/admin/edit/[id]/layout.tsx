import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

/**
 * Admin-only gate for /admin/edit/[id].
 *
 * Mirrors the /admin/create gate. The edit surface itself is shared code
 * with /dashboard/edit/[id] — same component, different URL + different
 * auth gate so the URL matches who's actually editing. Regular users land
 * on /dashboard/edit/[id] from their own panel; admins land here from the
 * publications list in /admin.
 */
export default async function AdminEditLayout({
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
  if (!user) redirect('/ingresar?redirect=/admin')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    // Non-admin bookmarked /admin/edit/<id>? Send them to the user-scoped
    // equivalent so they can still edit their own post if they own it.
    redirect('/dashboard')
  }

  return <>{children}</>
}
