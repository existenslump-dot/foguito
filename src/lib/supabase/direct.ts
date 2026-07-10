'use client'

/**
 * Direct PostgREST fetch that bypasses the @supabase/ssr SDK.
 *
 * Why: the SDK serializes every auth + data call through navigator.locks
 * on the browser. Parallel ops (Speed Insights, Analytics, admin
 * background fetches, session refresh) can leave the `sb-{ref}-auth-token`
 * lock held indefinitely — after which any subsequent SDK call
 * (`auth.getUser`, `from(...).select`, etc.) hangs forever. The same
 * contention pattern killed the MFA flow and the admin edit load/save.
 *
 * These helpers read the access token from the auth cookie and issue
 * plain `fetch()` calls with `apikey` + `Authorization: Bearer` headers,
 * skipping the lock entirely. Use ONLY where the hang has been observed
 * or where parallel load latency matters — the SDK is fine for the rest
 * of the app, and the global token refresh still lives there.
 */

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

// Derives "xyz" from "https://xyz.supabase.co" — the ref that prefixes
// the auth-token cookie name. Returns '' if the env var is malformed so
// callers fall through to the "not signed in" branch instead of crashing.
function projectRef(): string {
  try {
    return new URL(SUPABASE_URL).hostname.split('.')[0]
  } catch { return '' }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = name + '='
  const row = document.cookie.split('; ').find(c => c.startsWith(prefix))
  if (!row) return null
  return decodeURIComponent(row.slice(prefix.length))
}

/**
 * Reads the Supabase session cookie, including the chunked form
 * (`...auth-token.0`, `...auth-token.1`, ...) that @supabase/ssr falls
 * back to when the session payload exceeds the 4 KB cookie limit.
 * Returns the raw cookie value (still `base64-...` or JSON-encoded).
 */
export function readAuthCookieRaw(): string | null {
  const ref = projectRef()
  if (!ref) return null
  const base = `sb-${ref}-auth-token`
  const single = readCookie(base)
  if (single) return single
  const parts: string[] = []
  for (let i = 0; i < 20; i++) {
    const chunk = readCookie(`${base}.${i}`)
    if (chunk === null) break
    parts.push(chunk)
  }
  return parts.length ? parts.join('') : null
}

type Session = {
  access_token: string
  refresh_token?: string
  expires_at?: number
  user?: { id: string }
}

/**
 * Base64URL encode — the alphabet @supabase/ssr uses for the session
 * cookie payload. Standard base64 (`+`, `/`, `=`) is NOT compatible:
 * the SDK's `stringFromBase64URL` decoder throws on `+` or `/` chars,
 * which leaves the cookie unreadable from the SDK's perspective even
 * though we wrote a valid (but wrongly-encoded) value. Manifested in
 * prod as UserHeader blank + /admin queries returning 0 rows post-
 * login, because the SDK treated the session as absent.
 *
 * Uses TextEncoder so emoji / non-ASCII in the user object (rare but
 * possible via metadata) don't throw the way a naked btoa(str) would.
 */
function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Base64URL decode — inverse of `base64UrlEncode`, tolerant of padding. */
function base64UrlDecode(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  const rem = padded.length % 4
  const b64 = rem === 0 ? padded : padded + '='.repeat(4 - rem)
  const binary = atob(b64)
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(buf)
}

/**
 * Parses the cookie payload into a session object. @supabase/ssr 0.9+
 * wraps the JSON in `base64-<b64url>`; older values are raw JSON.
 */
export function parseSession(raw: string | null): Session | null {
  if (!raw) return null
  let payload = raw
  if (payload.startsWith('base64-')) {
    try { payload = base64UrlDecode(payload.slice(7)) } catch { return null }
  }
  try {
    const parsed = JSON.parse(payload)
    if (parsed && typeof parsed.access_token === 'string') return parsed as Session
    return null
  } catch { return null }
}

export function getAccessToken(): string | null {
  return parseSession(readAuthCookieRaw())?.access_token ?? null
}

/**
 * Returns the signed-in user's id by decoding the `sub` claim of the
 * JWT — avoids a network round trip (and another lock acquisition) for
 * a value that is already in memory.
 */
export function getUserId(): string | null {
  const token = getAccessToken()
  if (!token) return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(atob(parts[1]))
    return typeof payload?.sub === 'string' ? payload.sub : null
  } catch { return null }
}

// ──────────────────────────────────────────────────────────────────────
// Auth: sign-in / sign-up bypassing the SDK lock.
//
// The GoTrue REST API is happy to be called directly with the anon key;
// on success we need to install the cookie that @supabase/ssr would have
// written, so subsequent page loads (which use the SDK) see the session.
// ──────────────────────────────────────────────────────────────────────

// Matches the chunk ceiling @supabase/ssr uses internally — leaves room
// for the cookie name, path, domain, and sameSite attributes under the
// 4096-byte-per-cookie browser limit.
const COOKIE_CHUNK_SIZE = 3600

function cookieAttrs(): string {
  const base = 'path=/; samesite=lax'
  // localhost / 127.0.0.1 sends non-secure cookies back; anywhere else
  // enforce `secure` so the cookie only rides over https.
  if (typeof window === 'undefined') return base
  const isLocalhost = /^(localhost|127\.|0\.0\.0\.0)/.test(window.location.hostname)
  return isLocalhost ? base : `${base}; secure`
}

function clearCookieChunks(baseName: string) {
  if (typeof document === 'undefined') return
  const attrs = cookieAttrs()
  for (let i = 0; i < 20; i++) {
    document.cookie = `${baseName}.${i}=; ${attrs}; max-age=0`
  }
  document.cookie = `${baseName}=; ${attrs}; max-age=0`
}

function writeCookieChunks(baseName: string, value: string) {
  if (typeof document === 'undefined') return
  const attrs = cookieAttrs()
  // Always clear any lingering chunks from a prior session first — if the
  // previous session was bigger and split into `.0/.1/.2` and the new one
  // fits in one cookie, stale `.1` / `.2` remain and parseSession chokes.
  clearCookieChunks(baseName)
  if (value.length <= COOKIE_CHUNK_SIZE) {
    document.cookie = `${baseName}=${encodeURIComponent(value)}; ${attrs}`
    return
  }
  for (let i = 0; i * COOKIE_CHUNK_SIZE < value.length; i++) {
    const chunk = value.slice(i * COOKIE_CHUNK_SIZE, (i + 1) * COOKIE_CHUNK_SIZE)
    document.cookie = `${baseName}.${i}=${encodeURIComponent(chunk)}; ${attrs}`
  }
}

/**
 * Wipes the `sb-{ref}-auth-token` cookie (single + every chunk) so the
 * next SDK call sees a signed-out state. Safe to call on server-side
 * (no-op when document is undefined) and idempotent.
 */
export function clearAuthCookie(): void {
  const ref = projectRef()
  if (!ref) return
  clearCookieChunks(`sb-${ref}-auth-token`)
}

/**
 * Writes a freshly-acquired session into the `sb-{ref}-auth-token`
 * cookie using the same `base64-<b64>` envelope @supabase/ssr writes,
 * so the SDK on the next page load reads it transparently. Handles
 * chunking automatically when the payload > 3.6 KB.
 */
export function writeAuthCookie(session: Session): void {
  const ref = projectRef()
  if (!ref) return
  // Base64URL (not standard base64) — @supabase/ssr's decoder throws on
  // `+` / `/` chars. See `base64UrlEncode` above for the why.
  const encoded = 'base64-' + base64UrlEncode(JSON.stringify(session))
  writeCookieChunks(`sb-${ref}-auth-token`, encoded)
}

type AuthResult = { data: { session: Session | null }; error: SupabaseFetchError | null }

async function postAuth(endpoint: string, body: unknown): Promise<AuthResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return { data: { session: null }, error: { message: 'Supabase env vars missing', status: 0 } }
  }
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}${endpoint}`, {
      method:  'POST',
      headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(body),
      credentials: 'omit',
    })
  } catch (err) {
    return { data: { session: null }, error: { message: err instanceof Error ? err.message : 'Network error', status: 0 } }
  }
  let payload: unknown = null
  try { payload = await res.json() } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    // GoTrue error shape: `{ error_description | msg | message | code }`.
    // Preserve whichever field is present so the existing UI copy-mapping
    // (captcha / credentials / rate limit) keeps working unchanged.
    const p = payload as { error_description?: string; msg?: string; message?: string; code?: string } | null
    const message = p?.error_description || p?.msg || p?.message || `HTTP ${res.status}`
    return { data: { session: null }, error: { message, status: res.status, code: p?.code } }
  }
  // /auth/v1/token returns the session flat; /auth/v1/signup wraps it
  // under `session` when email confirmation is disabled and returns
  // `{ user, session: null }` when it is required. Accept both shapes.
  const p = payload as (Session & { session?: Session | null }) | null
  const session = (p && typeof (p as Session).access_token === 'string')
    ? (p as Session)
    : (p?.session ?? null)
  if (session) writeAuthCookie(session)
  return { data: { session }, error: null }
}

/**
 * Password grant against `/auth/v1/token?grant_type=password`. Accepts
 * the same captcha-token field the SDK does (`gotrue_meta_security`)
 * and installs the session cookie on success.
 */
export function signInWithPassword(args: { email: string; password: string; captchaToken?: string | null }): Promise<AuthResult> {
  const body: Record<string, unknown> = { email: args.email, password: args.password }
  if (args.captchaToken) body.gotrue_meta_security = { captcha_token: args.captchaToken }
  return postAuth('/auth/v1/token?grant_type=password', body)
}

/**
 * PKCE code_verifier / code_challenge helpers.
 *
 * @supabase/ssr hard-codes `flowType: 'pkce'` on BOTH createBrowserClient
 * and createServerClient (it spreads the caller's `auth` options and then
 * overrides `flowType` — you cannot opt into the implicit grant). So the
 * whole app is a PKCE deployment whether we like it or not.
 *
 * The previous signInWithOAuth hit `/auth/v1/authorize` with NO
 * `code_challenge`, which makes GoTrue fall back to the **implicit** grant
 * (tokens in the URL hash). The server /auth/callback can't read a hash, so
 * it bounced to /auth/confirm, where the browser SDK (locked to pkce) saw an
 * implicit callback, threw `AuthPKCEGrantCodeExchangeError: Not a valid PKCE
 * flow url`, returned session:null and redirected to /ingresar?error=auth —
 * the exact Google-login bug (user created in Supabase, session never
 * persisted in the app).
 *
 * Fix: initiate a real PKCE handshake here — generate a verifier, stash it
 * in the SAME cookie the SDK reads (`{storageKey}-code-verifier`), and send
 * the derived `code_challenge`. GoTrue then returns `?code=` to
 * /auth/callback, whose existing `exchangeCodeForSession` reads the verifier
 * cookie server-side and completes the exchange.
 */

// Mirrors auth-js `generatePKCEVerifier` (helpers.ts): 56 random 32-bit
// words, low byte of each rendered as 2 hex chars → a 112-char verifier
// drawn from [0-9a-f]. Being hex it never collides with the SDK's `base64-`
// cookie-encoding sentinel and needs no percent-encoding, so the server
// reads back exactly what we wrote.
function generatePkceVerifier(): string {
  const dec2hex = (dec: number) => ('0' + dec.toString(16)).slice(-2)
  const array = new Uint32Array(56)
  crypto.getRandomValues(array)
  return Array.from(array, dec2hex).join('')
}

// Mirrors auth-js `generatePKCEChallenge`: base64url(SHA-256(verifier)).
// Requires WebCrypto (present in every https / localhost secure context,
// which is everywhere this app runs). Returns null if unavailable so the
// caller can degrade instead of throwing an unhandled rejection.
async function generatePkceChallenge(verifier: string): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  let binary = ''
  const bytes = new Uint8Array(digest)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Builds the OAuth authorize URL and redirects the tab, running a PKCE
 * handshake first so GoTrue returns an exchangeable `?code=` (see the block
 * comment above). Bypasses the SDK's `navigator.locks` mutex — the reason
 * the rest of direct.ts exists — while staying wire-compatible with the
 * server-side `exchangeCodeForSession` in /auth/callback.
 *
 * `queryParams` is passed through verbatim into the authorize URL —
 * Supabase forwards recognised ones to the provider (e.g. `prompt`,
 * `login_hint`, `scope`). Async, but callers fire-and-forget: the browser
 * navigates away once `window.location.href` is set.
 */
export async function signInWithOAuth(args: {
  provider: 'google' | 'github' | 'apple' | 'azure' | 'facebook' | 'twitter' | 'discord'
  redirectTo: string
  queryParams?: Record<string, string>
}): Promise<void> {
  if (typeof window === 'undefined' || !SUPABASE_URL) return
  const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`)
  url.searchParams.set('provider', args.provider)
  url.searchParams.set('redirect_to', args.redirectTo)

  // PKCE: persist the verifier under the exact storage key the SDK's
  // server client reads during exchangeCodeForSession, then send the
  // challenge. SameSite=Lax (see cookieAttrs) is what lets the cookie ride
  // the top-level provider→/auth/callback redirect back to our origin.
  // Wrapped so a WebCrypto hiccup can never trap the user on a dead button —
  // worst case we redirect without PKCE, which is no worse than pre-fix.
  try {
    const ref = projectRef()
    if (ref) {
      const verifier = generatePkceVerifier()
      const challenge = await generatePkceChallenge(verifier)
      if (verifier && challenge) {
        writeCookieChunks(`sb-${ref}-auth-token-code-verifier`, verifier)
        url.searchParams.set('code_challenge', challenge)
        url.searchParams.set('code_challenge_method', 's256')
      }
    }
  } catch (err) {
    console.error('[auth-oauth] PKCE setup failed, redirecting without it', err)
  }

  if (args.queryParams) {
    for (const [k, v] of Object.entries(args.queryParams)) url.searchParams.set(k, v)
  }
  window.location.href = url.toString()
}

/**
 * Signs the user out. Hits `POST /auth/v1/logout?scope={scope}` with
 * the Bearer token so the session is revoked server-side, then clears
 * the cookie locally **regardless** of the server response — a network
 * hiccup shouldn't trap the user in a zombie "logged in" state.
 *
 * `scope=local` revokes only this session; `scope=global` revokes every
 * active session for the user (mirrors the SDK's same-named option).
 */
export async function signOut(args?: { scope?: 'local' | 'global' }): Promise<{ error: SupabaseFetchError | null }> {
  const scope = args?.scope ?? 'local'
  const token = getAccessToken()
  let error: SupabaseFetchError | null = null
  if (SUPABASE_URL && SUPABASE_ANON && token) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=${scope}`, {
        method: 'POST',
        headers: {
          apikey:        SUPABASE_ANON,
          Authorization: `Bearer ${token}`,
          Accept:        'application/json',
        },
        credentials: 'omit',
      })
      if (!res.ok && res.status !== 204) {
        error = { message: `Logout failed (HTTP ${res.status})`, status: res.status }
      }
    } catch (err) {
      error = { message: err instanceof Error ? err.message : 'Network error', status: 0 }
    }
  }
  // Clear the cookie even on server failure — the user clicked Salir
  // and we honour that intent; the next SDK call will see no session.
  clearAuthCookie()
  return { error }
}

/**
 * Email signup against `/auth/v1/signup`. `data` is user metadata
 * (stored on `auth.users.raw_user_meta_data`); `captchaToken` is
 * validated server-side when the Supabase project has captcha enabled.
 */
export function signUp(args: {
  email: string
  password: string
  captchaToken?: string | null
  data?: Record<string, unknown>
}): Promise<AuthResult> {
  const body: Record<string, unknown> = { email: args.email, password: args.password }
  if (args.data) body.data = args.data
  if (args.captchaToken) body.gotrue_meta_security = { captcha_token: args.captchaToken }
  return postAuth('/auth/v1/signup', body)
}

/**
 * Triggers Supabase to send a password-recovery email. Hits
 * `/auth/v1/recover` directly — same anti-lock pattern as signIn/signUp.
 * Returns a generic `{ error }` shape; success is the absence of error.
 * GoTrue intentionally returns 200 even when the email doesn't exist
 * (anti-enumeration); we surface only network / captcha errors.
 */
export async function resetPasswordForEmail(args: {
  email: string
  redirectTo: string
  captchaToken?: string | null
}): Promise<{ error: SupabaseFetchError | null }> {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return { error: { message: 'Supabase env vars missing', status: 0 } }
  }
  const body: Record<string, unknown> = { email: args.email }
  if (args.captchaToken) body.gotrue_meta_security = { captcha_token: args.captchaToken }
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(args.redirectTo)}`, {
      method:  'POST',
      headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(body),
      credentials: 'omit',
    })
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : 'Network error', status: 0 } }
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    let code: string | undefined
    try {
      const p = await res.json() as { error_description?: string; msg?: string; message?: string; code?: string }
      message = p?.error_description || p?.msg || p?.message || message
      code = p?.code
    } catch { /* non-JSON */ }
    return { error: { message, status: res.status, code } }
  }
  return { error: null }
}

/**
 * Updates the authed user's password via `PUT /auth/v1/user`. Requires
 * a valid Bearer token (the cookie set by either signIn or the
 * recovery-link callback). Returns the updated session if GoTrue
 * issued a fresh token, otherwise just `{ error }`.
 */
export async function updateUserPassword(args: { password: string }): Promise<{ error: SupabaseFetchError | null }> {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return { error: { message: 'Supabase env vars missing', status: 0 } }
  }
  const token = getAccessToken()
  if (!token) return { error: { message: 'No active session', status: 401 } }
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method:  'PUT',
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body:    JSON.stringify({ password: args.password }),
      credentials: 'omit',
    })
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : 'Network error', status: 0 } }
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    let code: string | undefined
    try {
      const p = await res.json() as { error_description?: string; msg?: string; message?: string; code?: string }
      message = p?.error_description || p?.msg || p?.message || message
      code = p?.code
    } catch { /* non-JSON */ }
    return { error: { message, status: res.status, code } }
  }
  return { error: null }
}

export type SupabaseFetchError = { message: string; status: number; code?: string }
export type SupabaseFetchResult<T> = { data: T | null; error: SupabaseFetchError | null }

type SupabaseFetchInit = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
  /** Return the first array element under `data` (mirrors `.single()`). */
  single?: boolean
  /** Skip return=representation on writes — use when you don't need the row back. */
  noReturn?: boolean
}

/**
 * GET/POST/PATCH/DELETE against `${SUPABASE_URL}/rest/v1/${path}` with
 * the access token from the cookie. Shape matches supabase-js so call
 * sites can read `{ data, error }` as before.
 *
 * `path` is the postgrest path + query (e.g. `posts?id=eq.abc&select=*`).
 * Caller is responsible for URL-encoding any untrusted value.
 */
export async function supabaseFetch<T = unknown>(
  path: string,
  init: SupabaseFetchInit = {},
): Promise<SupabaseFetchResult<T>> {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return { data: null, error: { message: 'Supabase env vars missing', status: 0 } }
  }
  // Authorization is optional — anon callers (PostDetailView for logged-out
  // visitors) need to read RLS-public rows without a session. PostgREST treats
  // a request with `apikey` only as the `anon` role and applies RLS; with a
  // Bearer JWT it switches to `authenticated`. Mirrors the SDK's behavior.
  // Previously this returned a synthetic 401 client-side when no cookie was
  // present, which broke every post-detail page for logged-out users after
  // PR #70 migrated PostDetailView off the SDK.
  const token = getAccessToken()
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON,
    Accept: 'application/json',
    ...(init.headers ?? {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const method = init.method ?? 'GET'
  if (init.body !== undefined) headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
  if (method !== 'GET' && !init.noReturn) {
    headers['Prefer'] = headers['Prefer'] ?? 'return=representation'
  }
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers,
      body:    init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal:  init.signal,
      credentials: 'omit',
    })
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : 'Network error', status: 0 } }
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    let code: string | undefined
    try {
      const body = await res.json()
      if (typeof body?.message === 'string') message = body.message
      else if (typeof body?.error === 'string') message = body.error
      if (typeof body?.code === 'string') code = body.code
    } catch { /* non-JSON error body */ }
    return { data: null, error: { message, status: res.status, code } }
  }
  // 204 No Content + empty bodies on noReturn writes.
  if (res.status === 204 || init.noReturn) return { data: null, error: null }
  try {
    const body = await res.json()
    if (init.single && Array.isArray(body)) return { data: (body[0] ?? null) as T, error: null }
    return { data: body as T, error: null }
  } catch {
    return { data: null, error: { message: 'Invalid JSON in response', status: res.status } }
  }
}
