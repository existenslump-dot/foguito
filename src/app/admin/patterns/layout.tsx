import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

/**
 * Admin-only gate for /admin/patterns.
 *
 * Same pattern as /admin/audit-log/layout.tsx — a server-side bouncer before
 * the client component loads. RLS on profiles/posts/reports filters naturally
 * (admin reads all, users don't), but the explicit redirect gives clear
 * feedback instead of a silent empty table.
 */
export default async function PatternsLayout({
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
  if (!user) redirect('/ingresar?redirect=/admin/patterns')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    redirect('/')
  }

  return <>{children}</>
}
