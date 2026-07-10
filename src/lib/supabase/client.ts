'use client'
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser-only Supabase singleton.
 *
 * Prevents multiple GoTrueClient instances, which cause auth lock timeouts +
 * "Multiple instances detected" warnings when individual components each call
 * createClient(). Lazy-init via a Proxy so the module can be imported from
 * shared code without constructing a client during SSR snapshot — the actual
 * `createBrowserClient` call only fires the first time a property is read on
 * the browser.
 *
 * Session policy: auth cookies are written as *session cookies* (no maxAge /
 * no Expires), so closing the browser terminates the session. Refresh and
 * multi-tab still work inside the same browser run because the cookie lives
 * in memory until the process exits. Paired with the IdleLogout watcher that
 * signs the user out after 15 min of inactivity.
 *
 * Usage (anywhere on the client):
 *   import { supabase } from '@/lib/supabase/client'
 */

let _client: SupabaseClient | null = null

function parseCookies(): { name: string; value: string }[] {
  if (typeof document === 'undefined') return []
  return document.cookie
    .split('; ')
    .filter(Boolean)
    .map(cookie => {
      const eq = cookie.indexOf('=')
      if (eq < 0) return { name: cookie, value: '' }
      return {
        name:  cookie.slice(0, eq),
        value: decodeURIComponent(cookie.slice(eq + 1)),
      }
    })
}

function writeSessionCookie(
  name: string,
  value: string,
  options: { path?: string; domain?: string; sameSite?: string; secure?: boolean } = {},
) {
  if (typeof document === 'undefined') return
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`path=${options.path ?? '/'}`)
  if (options.domain)   parts.push(`domain=${options.domain}`)
  if (options.sameSite) parts.push(`samesite=${options.sameSite}`)
  if (options.secure)   parts.push('secure')
  // IMPORTANT: no `max-age` / no `expires` → session cookie. The cookie is
  // dropped when the browser process closes (not individual tabs).
  document.cookie = parts.join('; ')
}

function getClient(): SupabaseClient {
  if (_client) return _client
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    // Make the failure obvious + recoverable instead of silently returning
    // an unusable client. In prod these are required at build time via
    // Vercel env vars, so this branch fires only in broken local setups.
    throw new Error('[supabase/client] NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are missing')
  }
  _client = createBrowserClient(url, anon, {
    cookies: {
      getAll: parseCookies,
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          if (!value) {
            // Removal: expire immediately so the browser evicts the name.
            document.cookie = `${name}=; path=${options?.path ?? '/'}; max-age=0`
            return
          }
          writeSessionCookie(name, value, {
            path:     options?.path,
            domain:   options?.domain,
            sameSite: typeof options?.sameSite === 'string' ? options.sameSite : undefined,
            secure:   options?.secure,
          })
        })
      },
    },
    auth: {
      // No-op lock — JS event loop already serializes auth calls per tab,
      // which is the granularity that actually matters for our app. The
      // default `processLock` (navigator.locks-based) was leaving the
      // `sb-{ref}-auth-token` mutex held indefinitely in production
      // (observed via `navigator.locks.query()` returning `{held: 1}`
      // on /admin), which froze every subsequent SDK call on the page —
      // UserHeader, /admin listing, /dashboard, /admin/edit load, /ingresar
      // submit, /registro submit. The direct-PostgREST helpers
      // (src/lib/supabase/direct.ts) route the critical auth paths
      // around the lock, but every page with SDK calls (e.g. /admin's
      // publication list) still hangs until the lock is contractually
      // removed here. Trade-off accepted: cross-tab refresh races can
      // now briefly invalidate each other's tokens, but that edge case
      // costs the user a single re-login vs an unusable admin dashboard.
      lock: async (_name, _timeout, fn) => fn(),
    },
  })
  return _client
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (client as any)[prop]
    return typeof value === 'function' ? value.bind(client) : value
  },
})
