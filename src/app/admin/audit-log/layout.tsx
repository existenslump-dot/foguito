import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

/**
 * Admin-only gate for /admin/audit-log.
 *
 * Same pattern as /admin/create/layout.tsx — a server-side bouncer before the
 * client component loads. The audit_log RLS also filters SELECT by is_admin,
 * but that check is the last line of defense: if a non-admin user slips
 * through some bug, the query would return 0 rows and they'd see an empty
 * table without understanding why. An explicit redirect in the layout is
 * clearer.
 */
export default async function AuditLogLayout({
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
  if (!user) redirect('/ingresar?redirect=/admin/audit-log')

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
