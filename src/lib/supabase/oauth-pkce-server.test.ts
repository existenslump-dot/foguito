// @vitest-environment node
//
// Integration guard for the OAuth PKCE contract that spans the client and
// server halves of the Google-login flow:
//
//   client  (src/lib/supabase/direct.ts signInWithOAuth)
//     → writes the verifier to the cookie `sb-{ref}-auth-token-code-verifier`
//   server  (src/app/auth/callback/route.ts)
//     → createServerClient(...).auth.exchangeCodeForSession(code)
//     → must read THAT cookie and POST it as `code_verifier` to GoTrue
//
// If the cookie name, encoding, or the server client's get-based cookie
// adapter ever drift, exchangeCodeForSession silently fails with
// AuthPKCECodeVerifierMissingError and Google login regresses to
// /ingresar?error=auth. This test pins the whole round-trip.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServerClient } from '@supabase/ssr'

const REF = 'zzbfzvstqbfwsrlwcqhi'
const SUPABASE_URL = `https://${REF}.supabase.co`
const ANON = 'anon-key-under-test'
// A hex verifier exactly like the one direct.ts generatePkceVerifier() emits.
const VERIFIER = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8'
const CODE = 'auth-code-from-provider'

afterEach(() => vi.unstubAllGlobals())

describe('OAuth PKCE server exchange reads the verifier cookie direct.ts wrote', () => {
  it('forwards the stored verifier as code_verifier to /token?grant_type=pkce', async () => {
    // In-memory cookie jar, seeded exactly as the browser would present it
    // to the /auth/callback request: the verifier under the SDK storage key.
    // Raw value (no `base64-` prefix) — the server storage returns it as-is.
    const jar = new Map<string, string>([
      [`sb-${REF}-auth-token-code-verifier`, VERIFIER],
    ])

    let tokenBody: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
      if (url.includes('/token') && url.includes('grant_type=pkce')) {
        tokenBody = JSON.parse(String(init?.body ?? '{}'))
        const session = {
          access_token: 'header.eyJzdWIiOiJ1c2VyLTEifQ.sig',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: 9_999_999_999,
          refresh_token: 'refresh-xyz',
          user: { id: 'user-1', aud: 'authenticated', email: 'x@y.z' },
        }
        return new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      // /user or anything else the SDK might touch after sign-in.
      return new Response(JSON.stringify({ id: 'user-1', aud: 'authenticated' }), { status: 200 })
    }))

    // Same construction and cookie adapter shape as src/app/auth/callback/route.ts.
    const supabase = createServerClient(SUPABASE_URL, ANON, {
      cookies: {
        get(name: string) { return jar.get(name) },
        set(name: string, value: string) { jar.set(name, value) },
        remove(name: string) { jar.delete(name) },
      },
    })

    const { data, error } = await supabase.auth.exchangeCodeForSession(CODE)

    expect(error).toBeNull()
    expect(data.session?.access_token).toBeTruthy()
    // The crux: the server sent OUR cookie's verifier, unmodified.
    expect(tokenBody).not.toBeNull()
    expect(tokenBody!.auth_code).toBe(CODE)
    expect(tokenBody!.code_verifier).toBe(VERIFIER)

    // And the callback actually PERSISTS the session: the SIGNED_IN event
    // drives applyServerStorage → setAll, so the auth-token cookie is written
    // back through the same adapter /auth/callback uses. Without this the user
    // would land on /dashboard still signed-out.
    const sessionCookie = jar.get(`sb-${REF}-auth-token`) ?? jar.get(`sb-${REF}-auth-token.0`)
    expect(sessionCookie).toBeTruthy()
    // Verifier is single-use — consumed and cleared by the exchange.
    expect(jar.get(`sb-${REF}-auth-token-code-verifier`)).toBeUndefined()
  })
})
