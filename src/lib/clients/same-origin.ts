/**
 * Same-origin guard for authenticated mutating endpoints.
 *
 * SameSite=lax on the Supabase auth cookie (see middleware.ts) already
 * blocks automatic attachment on cross-origin POST/PATCH/DELETE, which
 * covers the classic CSRF vector. This helper is belt-and-suspenders
 * for the cases SameSite doesn't catch:
 *   - Bearer token exposed via XSS / malicious extension firing a
 *     cross-origin fetch with explicit Authorization header.
 *   - Future cookie policy regression (e.g., a browser ships a change
 *     that widens cross-origin cookie attachment).
 *
 * Compares the incoming Origin (falling back to Referer) host against
 * every host this deployment legitimately serves:
 *
 *   1. The request's own host (`x-forwarded-host`, falling back to
 *      `Host`) — the canonical same-origin reference, same trust model
 *      as Next.js' built-in Server Action CSRF check. A cross-site page
 *      can't influence Origin *or* Host, and a direct client that forges
 *      both carries no victim cookies, so this is safe with zero config
 *      and makes the guard work out of the box on any domain the app is
 *      actually served from.
 *   2. Vercel's system envs (`VERCEL_URL`, `VERCEL_BRANCH_URL`,
 *      `VERCEL_PROJECT_PRODUCTION_URL`) — belt-and-suspenders for
 *      previews / the production alias if a proxy rewrites Host.
 *   3. `NEXT_PUBLIC_APP_URL` — the configured canonical domain (also
 *      consumed by emails/SEO/sitemap; see SETUP.md §10).
 *   4. `APP_URL_ALIASES` — extra accepted origins, comma-separated.
 *      Meant for domain migrations: while the old domain still redirects
 *      to the new one, cookies/referers can still arrive from it. Delete
 *      the var once the old domain stops receiving real traffic.
 *
 * Dev / test without APP_URL stays fully permissive (curl-friendly).
 * A stale or malformed APP_URL no longer 403s the deployment's own
 * traffic — (1) keeps same-origin requests working; the env only *adds*
 * hosts. Requests with neither Origin nor Referer are rejected.
 *
 * Used by `requireUser()` / `requireAdmin()` and a handful of direct
 * callers (signout, account delete, signed media URLs) — one shared
 * implementation so no regression hits only half of the surface area.
 */

/** Normalise a URL or bare host ("example.com", "https://example.com/x")
 *  to its `host` (hostname[:port], lowercased). Null for empty/garbage. */
function hostOf(urlish: string | null | undefined): string | null {
  const value = urlish?.trim()
  if (!value) return null
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).host
  } catch {
    return null
  }
}

export function isSameOrigin(req: Request): boolean {
  // Dev / test without APP_URL — allow everything (local curl, vitest).
  if (!process.env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV !== 'production') {
    return true
  }

  const allowedHosts = new Set<string>()
  const allow = (urlish: string | null | undefined) => {
    const host = hostOf(urlish)
    if (host) allowedHosts.add(host)
  }

  // (1) The host the browser actually targeted. `x-forwarded-host` can be
  // a comma-separated chain when several proxies stack — the first entry
  // is the client-facing host.
  allow(req.headers.get('x-forwarded-host')?.split(',')[0])
  allow(req.headers.get('host'))

  // (2) Vercel system envs (bare hosts, no scheme).
  allow(process.env.VERCEL_URL)
  allow(process.env.VERCEL_BRANCH_URL)
  allow(process.env.VERCEL_PROJECT_PRODUCTION_URL)

  // (3) Configured canonical domain.
  allow(process.env.NEXT_PUBLIC_APP_URL)

  // (4) Migration aliases (malformed entries are skipped by hostOf
  // instead of disabling the whole guard).
  for (const alias of (process.env.APP_URL_ALIASES || '').split(',')) {
    allow(alias)
  }

  const hdr = req.headers.get('origin') || req.headers.get('referer')
  const originHost = hostOf(hdr)
  return originHost !== null && allowedHosts.has(originHost)
}
