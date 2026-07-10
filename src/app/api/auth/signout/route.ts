import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { isSameOrigin } from '@/lib/clients/same-origin'

export async function POST(req: Request) {
  // Same-origin guard — a cross-origin POST shouldn't be able to log
  // the user out. SameSite=lax on the auth cookie blocks the common
  // case, but a Bearer-via-XSS scenario would still hit this endpoint
  // with the session cookie attached.
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
    }
  )

  await supabase.auth.signOut()

  return NextResponse.json({ ok: true })
}
