import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { safeRedirectPath } from '@/lib/safe-redirect'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const origin = requestUrl.origin

  // Explicit post-auth destination the user was trying to reach before
  // they were bounced to /ingresar. Only honored if it passes the
  // safeRedirectPath allowlist — anything else falls back to role default.
  // Using '' as the sentinel "no-valid-explicit" so we can keep the admin
  // default when the user arrived at OAuth without an explicit target.
  const rawRedirect = requestUrl.searchParams.get('redirect')
  const explicitRedirect = rawRedirect ? safeRedirectPath(rawRedirect, '') : ''

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value
          },
          set(name: string, value: string, options: CookieOptions) {
            cookieStore.set({ name, value, ...options })
          },
          remove(name: string, options: CookieOptions) {
            cookieStore.set({ name, value: '', ...options })
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Destination priority: explicit (validated) redirect > admin default
      // (/admin) > user default (/dashboard).
      if (explicitRedirect) {
        return NextResponse.redirect(`${origin}${explicitRedirect}`)
      }
      const userId = data?.user?.id
      if (userId) {
        const { data: profile, error: profileErr } = await supabase
          .from('profiles').select('is_admin').eq('id', userId).single()
        if (profileErr) console.error('[auth-callback] profile lookup failed', profileErr)
        if (profile?.is_admin) {
          return NextResponse.redirect(`${origin}/admin`)
        }
      }
      return NextResponse.redirect(`${origin}/dashboard`)
    }

    return new Response(`Error de Supabase al canjear codigo: ${error.message}`, { status: 400 })
  }

  // No code param — likely implicit flow with #access_token in hash.
  // Redirect to the client-side handler, preserving the validated redirect
  // param so /auth/confirm can route to the same destination after parsing
  // the hash-fragment session.
  const confirmUrl = explicitRedirect
    ? `${origin}/auth/confirm?redirect=${encodeURIComponent(explicitRedirect)}`
    : `${origin}/auth/confirm`
  return NextResponse.redirect(confirmUrl)
}