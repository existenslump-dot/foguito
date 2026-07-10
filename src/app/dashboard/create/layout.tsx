import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

/**
 * Self-service gate for /dashboard/create (1-active-post).
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
