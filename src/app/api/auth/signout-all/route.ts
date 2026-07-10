import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/auditLog'
import { isSameOrigin } from '@/lib/clients/same-origin'

export async function POST(req: Request) {
  // Same-origin guard — see signout/route.ts for rationale. signout-all
  // revokes EVERY session for the user globally, so the cross-origin
  // forced-logout impact would be even worse than the local signout.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  }

  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ignore cookie errors during signout
          }
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await supabase.auth.signOut({ scope: 'global' })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAudit({
    userId: user?.id,
    action: 'signout_all',
  })

  return NextResponse.json({ success: true })
}
