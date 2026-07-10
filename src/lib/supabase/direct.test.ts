import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// These tests exercise the cookie reader + session parser + JWT decoder
// in isolation. The `supabaseFetch` path is exercised via the consumer
// (edit/[id]/page.tsx) under integration / manual QA — mocking `fetch`
// here would verify plumbing but not the actual PostgREST contract.

const REF = 'zzbfzvstqbfwsrlwcqhi'

beforeEach(() => {
  // Fresh module state + env per test — the lib reads env at import time,
  // so we need to reset the module cache between different SUPABASE_URL.
  vi.resetModules()
  process.env.NEXT_PUBLIC_SUPABASE_URL       = `https://${REF}.supabase.co`
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY  = 'anon-key-under-test'
  // Blow away any cookies from previous tests.
  document.cookie.split('; ').forEach(c => {
    const name = c.split('=')[0]
    document.cookie = `${name}=; max-age=0; path=/`
  })
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
})

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/`
}

// Matches the @supabase/ssr base64url encoding (no `+`/`/`/`=`) used
// throughout the helpers under test. Simpler than TextEncoder for the
// ASCII-only payloads these tests generate.
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Minimal JWT factory — `header.payload.signature`, payload is base64url of JSON.
function makeJwt(sub: string): string {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ sub, role: 'authenticated', exp: 9e12 }))
  return `${header}.${payload}.signature-not-verified`
}

describe('readAuthCookieRaw', () => {
  it('returns null when no cookie is set', async () => {
    const { readAuthCookieRaw } = await import('./direct')
    expect(readAuthCookieRaw()).toBeNull()
  })

  it('reads a single unchunked cookie', async () => {
    setCookie(`sb-${REF}-auth-token`, 'base64-abc123')
    const { readAuthCookieRaw } = await import('./direct')
    expect(readAuthCookieRaw()).toBe('base64-abc123')
  })

  it('reassembles chunked cookies in order', async () => {
    setCookie(`sb-${REF}-auth-token.0`, 'part-A')
    setCookie(`sb-${REF}-auth-token.1`, 'part-B')
    setCookie(`sb-${REF}-auth-token.2`, 'part-C')
    const { readAuthCookieRaw } = await import('./direct')
    expect(readAuthCookieRaw()).toBe('part-Apart-Bpart-C')
  })
})

describe('parseSession', () => {
  it('returns null for null input', async () => {
    const { parseSession } = await import('./direct')
    expect(parseSession(null)).toBeNull()
  })

  it('parses base64-prefixed JSON payload', async () => {
    const session = { access_token: 'tok-123', refresh_token: 'rt-456' }
    const encoded = 'base64-' + b64url(JSON.stringify(session))
    const { parseSession } = await import('./direct')
    expect(parseSession(encoded)).toMatchObject({ access_token: 'tok-123', refresh_token: 'rt-456' })
  })

  it('parses raw JSON payload (legacy format)', async () => {
    const raw = JSON.stringify({ access_token: 'plain-tok' })
    const { parseSession } = await import('./direct')
    expect(parseSession(raw)).toMatchObject({ access_token: 'plain-tok' })
  })

  it('returns null for malformed base64', async () => {
    const { parseSession } = await import('./direct')
    expect(parseSession('base64-!@#$%not-base64')).toBeNull()
  })

  it('returns null when access_token is missing', async () => {
    const { parseSession } = await import('./direct')
    const encoded = 'base64-' + b64url(JSON.stringify({ refresh_token: 'rt-only' }))
    expect(parseSession(encoded)).toBeNull()
  })
})

describe('getUserId', () => {
  it('returns null when no session cookie exists', async () => {
    const { getUserId } = await import('./direct')
    expect(getUserId()).toBeNull()
  })

  it('decodes the sub claim from the access token JWT', async () => {
    const token = makeJwt('user-uuid-abc')
    const session = { access_token: token }
    setCookie(`sb-${REF}-auth-token`, 'base64-' + b64url(JSON.stringify(session)))
    const { getUserId } = await import('./direct')
    expect(getUserId()).toBe('user-uuid-abc')
  })

  it('returns null for malformed JWT', async () => {
    const session = { access_token: 'not.a.real.jwt' }
    setCookie(`sb-${REF}-auth-token`, 'base64-' + b64url(JSON.stringify(session)))
    const { getUserId } = await import('./direct')
    expect(getUserId()).toBeNull()
  })
})

describe('signInWithOAuth', () => {
  // jsdom refuses to redefine `window.location.href`, but replacing the
  // whole `window.location` with a plain settable object works and lets
  // us spy on what URL the helper navigates to. hostname:'localhost' keeps
  // cookieAttrs() from adding `secure`, so the PKCE verifier cookie is
  // actually stored under the jsdom (http) origin instead of being dropped.
  let originalLocation: Location
  beforeEach(() => {
    originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '', hostname: 'localhost' } as unknown as Location,
    })
  })
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation })
  })

  function readVerifierCookie(): string | null {
    const prefix = `sb-${REF}-auth-token-code-verifier=`
    const row = document.cookie.split('; ').find(c => c.startsWith(prefix))
    return row ? decodeURIComponent(row.slice(prefix.length)) : null
  }

  // Mirror of direct.ts generatePkceChallenge — used to independently verify
  // the challenge on the wire really is base64url(SHA-256(verifier)).
  async function expectedChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    let binary = ''
    new Uint8Array(digest).forEach(b => { binary += String.fromCharCode(b) })
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  it('redirects to the authorize endpoint with the provider + redirect_to', async () => {
    const { signInWithOAuth } = await import('./direct')
    await signInWithOAuth({ provider: 'google', redirectTo: 'https://app.example/auth/callback' })
    const url = new URL(window.location.href)
    expect(url.origin).toBe(`https://${REF}.supabase.co`)
    expect(url.pathname).toBe('/auth/v1/authorize')
    expect(url.searchParams.get('provider')).toBe('google')
    expect(url.searchParams.get('redirect_to')).toBe('https://app.example/auth/callback')
  })

  it('forwards extra queryParams (prompt, scope, etc.) to the URL', async () => {
    const { signInWithOAuth } = await import('./direct')
    await signInWithOAuth({
      provider: 'google',
      redirectTo: '/cb',
      queryParams: { prompt: 'select_account', login_hint: 'ada@example.com' },
    })
    const url = new URL(window.location.href)
    expect(url.searchParams.get('prompt')).toBe('select_account')
    expect(url.searchParams.get('login_hint')).toBe('ada@example.com')
  })

  it('runs a PKCE handshake: stores the verifier cookie + sends a matching s256 challenge', async () => {
    const { signInWithOAuth } = await import('./direct')
    await signInWithOAuth({ provider: 'google', redirectTo: 'https://app.example/auth/callback' })
    const url = new URL(window.location.href)

    // Verifier persisted under the exact key the SDK server client reads
    // during exchangeCodeForSession (`{storageKey}-code-verifier`).
    const verifier = readVerifierCookie()
    expect(verifier).toBeTruthy()
    // hex verifier → no chars that need percent-encoding, never the SDK's
    // `base64-` sentinel, so the server reads back exactly this value.
    expect(verifier!).toMatch(/^[0-9a-f]+$/)

    // The authorize URL carries the challenge GoTrue needs to return a
    // `?code=` we can exchange server-side.
    expect(url.searchParams.get('code_challenge_method')).toBe('s256')
    const challenge = url.searchParams.get('code_challenge')
    expect(challenge).toBeTruthy()
    expect(challenge).toBe(await expectedChallenge(verifier!))
  })
})

describe('signOut', () => {
  it('clears the auth cookie even if the network request fails', async () => {
    // Seed a session cookie so we can observe its removal.
    const session = { access_token: makeJwt('user-123') }
    setCookie(`sb-${REF}-auth-token`, 'base64-' + b64url(JSON.stringify(session)))

    // Stub fetch to reject — simulates offline or Supabase unreachable.
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network down'))

    const { signOut, readAuthCookieRaw } = await import('./direct')
    const res = await signOut()
    expect(res.error?.message).toMatch(/network down/i)
    expect(readAuthCookieRaw()).toBeNull()

    globalThis.fetch = originalFetch
  })

  it('returns no error on a 204 server response', async () => {
    setCookie(`sb-${REF}-auth-token`, 'base64-' + b64url(JSON.stringify({ access_token: makeJwt('u') })))
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))

    const { signOut, readAuthCookieRaw } = await import('./direct')
    const res = await signOut()
    expect(res.error).toBeNull()
    expect(readAuthCookieRaw()).toBeNull()

    globalThis.fetch = originalFetch
  })

  it('skips the server call when no session exists but still clears the cookie', async () => {
    const originalFetch = globalThis.fetch
    const spy = vi.fn()
    globalThis.fetch = spy

    const { signOut } = await import('./direct')
    const res = await signOut()
    expect(spy).not.toHaveBeenCalled()
    expect(res.error).toBeNull()

    globalThis.fetch = originalFetch
  })
})

describe('writeAuthCookie base64url contract', () => {
  // Regression test — @supabase/ssr's reader uses `stringFromBase64URL`
  // which throws on `+`, `/`, or `=` characters. An earlier version of
  // this helper used naked btoa (standard base64) which produced those
  // chars statistically; the SDK then silently treated the cookie as
  // absent, breaking UserHeader + all RLS-gated /admin queries.
  it('writes cookie payload in base64url alphabet (no + / =)', async () => {
    const { writeAuthCookie, readAuthCookieRaw } = await import('./direct')
    // Session with bytes that reliably produce + and / under standard
    // base64 — a tall JWT full of slashes + pluses in its signature.
    writeAuthCookie({
      access_token: 'aaaa'.repeat(100) + '////++++',
      refresh_token: 'bbbb'.repeat(100),
    })
    const raw = readAuthCookieRaw()
    expect(raw).not.toBeNull()
    expect(raw!.startsWith('base64-')).toBe(true)
    const payload = raw!.slice('base64-'.length)
    expect(payload).not.toMatch(/[+/=]/)
  })
})

describe('writeAuthCookie', () => {
  it('writes a single cookie for small sessions', async () => {
    const { writeAuthCookie, readAuthCookieRaw, parseSession } = await import('./direct')
    const session = { access_token: 'tok-small', refresh_token: 'rt' }
    writeAuthCookie(session)
    expect(parseSession(readAuthCookieRaw())).toMatchObject(session)
  })

  it('chunks and reassembles sessions over the 3600-byte ceiling', async () => {
    const { writeAuthCookie, readAuthCookieRaw, parseSession } = await import('./direct')
    const big = 'x'.repeat(10_000)
    const session = { access_token: big }
    writeAuthCookie(session)
    // Sanity check: at least one `.0` chunk should exist on document.cookie.
    expect(document.cookie).toContain(`sb-${REF}-auth-token.0=`)
    // Round-trip the session through the reader + parser.
    expect(parseSession(readAuthCookieRaw())).toMatchObject({ access_token: big })
  })

  it('clears stale chunks when a new smaller session is written', async () => {
    const { writeAuthCookie, readAuthCookieRaw, parseSession } = await import('./direct')
    // First login — big, chunked.
    writeAuthCookie({ access_token: 'y'.repeat(10_000) })
    expect(document.cookie).toContain(`sb-${REF}-auth-token.0=`)
    // Second login — small, single cookie. Old chunks must be evicted
    // or parseSession would read garbage (partial chunk 0 + stale 1/2).
    writeAuthCookie({ access_token: 'tok-fresh' })
    expect(parseSession(readAuthCookieRaw())).toMatchObject({ access_token: 'tok-fresh' })
    // The stale chunks should be gone — the getter finds the single
    // cookie instead of reassembling.
    expect(readAuthCookieRaw()).not.toContain('y'.repeat(100))
  })
})
