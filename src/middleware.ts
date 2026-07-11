import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/ip'
import { isCrawler } from '@/lib/crawler'
import { getViewerJurisdiction } from '@/lib/age-gate/viewer-geo'
import { MARKETPLACE } from '@/config/marketplace.config'

// Mirrors `TOTP_VERIFY_TTL_MS` in src/lib/totp.ts. Inlined here because
// totp.ts imports `node:crypto` + `otpauth`, which the edge runtime
// rejects — the middleware can't pull anything from that module.
const TOTP_VERIFY_TTL_MS = 12 * 60 * 60 * 1000

// ── Geo-blocking ──────────────────────────────────────────────────────────────
// Countries to serve, from the active market config — set per deployment
// without touching this file. The config module is import-pure (no
// node:crypto / otpauth), so it's safe for the edge runtime here.
const ALLOWED_COUNTRIES = MARKETPLACE.market.allowedCountries

// ── Crawler / social-card bot allowlist ───────────────────────────────────────
// Bots get two exemptions vs a regular visitor:
//   1. Skip geo-block — Googlebot crawls from US datacenters, would 100% hit
//      the 'blocked' redirect otherwise and index nothing.
//   2. Bypass the BetaGate client overlay via a server-set cookie.
// This is the allowed form of "cloaking": bots see the same content humans
// will see once authenticated, just without the login friction. The allowlist
// (`isCrawler`) lives in src/lib/crawler.ts. NOTE: the consumer age-gate does
// NOT reuse it — a forgeable UA must not open the age-gate, so gated adult
// content stays intentionally non-crawlable (see src/lib/age-gate/enforce.ts).

// ── Rate limit rules ──────────────────────────────────────────────────────────
// { pattern, limit, windowMs, keyType }
const RATE_RULES: {
  pattern: string | RegExp
  limit: number
  windowMs: number
  keyType: 'ip' | 'user'
}[] = [
  // ── Auth / account ────────────────────────────────────────────────────
  { pattern: /^\/api\/auth/,                        limit: 10,  windowMs: 15 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/register',                       limit: 10,  windowMs: 15 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/account/delete',                 limit: 3,   windowMs: 60 * 60 * 1000, keyType: 'ip' },
  // ── Posts / media ─────────────────────────────────────────────────────
  { pattern: '/api/posts',                          limit: 20,  windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/posts/validate-media',           limit: 60,  windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/media/signed-url',               limit: 100, windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/media/cleanup',                  limit: 30,  windowMs: 60 * 60 * 1000, keyType: 'ip' },
  // ── User actions ──────────────────────────────────────────────────────
  { pattern: '/api/reviews',                        limit: 5,   windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/report',                         limit: 10,  windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/favorites',                      limit: 60,  windowMs: 60 * 1000,       keyType: 'ip' },
  // ── Age verification (consumer gate) ──────────────────────────────────
  { pattern: '/api/age-verify/start',               limit: 10,  windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/webhooks/age-verify',            limit: 120, windowMs: 60 * 1000,       keyType: 'ip' },
  { pattern: '/api/contact',                        limit: 3,   windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/chat',                           limit: 20,  windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/me-quiero-publicar',             limit: 5,   windowMs: 60 * 60 * 1000, keyType: 'ip' },
  // ── Push / analytics ──────────────────────────────────────────────────
  { pattern: '/api/push/subscribe',                 limit: 10,  windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/push/send',                      limit: 60,  windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/analytics',                      limit: 120, windowMs: 60 * 1000,       keyType: 'ip' },
  { pattern: '/api/exchange-rates',                 limit: 60,  windowMs: 60 * 1000,       keyType: 'ip' },
  // ── Payments (user-facing) ────────────────────────────────────────────
  { pattern: '/api/pagos/mp/crear-preferencia',     limit: 10,  windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/pagos/mp/procesar-pago',         limit: 20,  windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/pagos/crypto',                   limit: 10,  windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/payments/elite-nowpayments',      limit: 5,   windowMs: 60 * 60 * 1000, keyType: 'ip' },
  // ── Payment webhooks (external services — allow burst) ───────────────
  { pattern: '/api/pagos/mp/webhook',               limit: 120, windowMs: 60 * 1000,       keyType: 'ip' },
  { pattern: '/api/pagos/crypto/webhook',           limit: 120, windowMs: 60 * 1000,       keyType: 'ip' },
  { pattern: '/api/webhooks/nowpayments',           limit: 120, windowMs: 60 * 1000,       keyType: 'ip' },
  // ── Admin (admin auth also enforced in-route) ─────────────────────────
  { pattern: '/api/admin/approve-post',             limit: 120, windowMs: 60 * 60 * 1000, keyType: 'ip' },
  { pattern: '/api/admin/backup',                   limit: 5,   windowMs: 60 * 60 * 1000, keyType: 'ip' },
  // ── Cron (CRON_SECRET also required in-route) ─────────────────────────
  { pattern: /^\/api\/cron\//,                      limit: 10,  windowMs: 60 * 1000,       keyType: 'ip' },
]

function findRateRule(pathname: string) {
  return RATE_RULES.find(r =>
    typeof r.pattern === 'string' ? pathname === r.pattern : r.pattern.test(pathname),
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const userAgent = request.headers.get('user-agent') || ''
  const bot = isCrawler(userAgent)

  // ── IndexNow ownership verification ─────────────────────────────────────
  // IndexNow (Bing + Yandex) asks for a text file at `/${KEY}.txt` whose
  // contents equal the key. We serve it dynamically from the env var so
  // the user can rotate the key without touching the filesystem. Runs
  // before geo-blocking so bots hitting from any country can verify.
  const indexNowKey = process.env.INDEXNOW_KEY
  if (indexNowKey && pathname === `/${indexNowKey}.txt`) {
    return new NextResponse(indexNowKey, {
      headers: {
        'Content-Type':  'text/plain',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }

  // ── IP extraction ───────────────────────────────────────────────────────
  const ip = getClientIp(request)

  // ── IP blocklist ────────────────────────────────────────────────────────
  const blocked = (process.env.BLOCKED_IPS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (ip !== 'unknown' && blocked.includes(ip)) {
    return new Response('Access denied', { status: 403 })
  }

  // ── Geo-blocking ────────────────────────────────────────────────────────
  // Bots (Googlebot, Bingbot, social-card fetchers, etc.) are exempt —
  // they crawl from US datacenters and would otherwise get a /blocked
  // redirect, killing indexation.
  // Opt-in (FEATURE_GEO_BLOCK). Off by default so the boilerplate is globally
  // reachable; enable for a single-country deployment.
  if (MARKETPLACE.features.geoBlock) {
    // Next 16 removed `request.geo` (it read `undefined` and silently fell back
    // to a constant 'CL', so the block was effectively broken). Read the
    // viewer's country from Vercel's geo header instead — the same signal the
    // consumer age-gate uses. FAIL-CLOSED: an unlocated viewer (country null)
    // is NOT in ALLOWED_COUNTRIES → blocked.
    const { country } = getViewerJurisdiction(request.headers)
    if (!bot && !ALLOWED_COUNTRIES.includes(country ?? '')) {
      return NextResponse.redirect(new URL('/blocked', request.url))
    }
  }

  // ── API rate limiting ───────────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    const rule = findRateRule(pathname)
    if (rule) {
      const key = `${ip}:${typeof rule.pattern === 'string' ? rule.pattern : pathname}`
      const { success, retryAfter } = await rateLimit(key, rule.limit, rule.windowMs)
      if (!success) {
        return new Response(
          JSON.stringify({ error: 'Demasiadas solicitudes. Intenta más tarde.' }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(retryAfter),
            },
          },
        )
      }
    }
    return NextResponse.next()
  }

  // ── Supabase session refresh (non-API routes) ──────────────────────────
  const response = NextResponse.next({
    request: { headers: request.headers },
  })

  // ── Bot bypass cookie for BetaGate ─────────────────────────────────────
  // Bots don't persist localStorage between requests, so the client-side
  // gate would show for every crawl. We set a first-party cookie that the
  // BetaGate component checks before rendering the overlay — same effect
  // as a human typing the password, but per-request.
  if (bot) {
    response.cookies.set('marketplace_beta_ok', '1', {
      httpOnly: false, // BetaGate (client component) needs to read it
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          // Session-cookie policy: strip persistent-expiry attrs so the
          // refresh-token rewrite doesn't re-arm a long-lived cookie. The
          // auth cookie lives in memory and dies when the browser closes.
          // See src/lib/supabase/client.ts for the client-side half.
          // Destructure with `void` consumers so ESLint doesn't flag the
          // omit-props as unused — the whole point is that we drop them.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { maxAge, expires, ...sessionOnly } = options
          response.cookies.set({ name, value, ...sessionOnly })
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: '', ...options, maxAge: 0 })
        },
      },
    },
  )

  const { data: userData } = await supabase.auth.getUser()

  // ── Admin gate ──────────────────────────────────────────────────────
  // /admin and /admin/* are server-side gated for three failure modes,
  // each producing a redirect BEFORE the page renders so non-admin
  // users never see the admin chrome (previously the redirect was
  // client-side via useEffect in src/app/admin/page.tsx, leaking the
  // empty-state admin layout for the brief render-then-redirect window).
  //
  //   1. Not logged in       → /ingresar?next=<path>
  //   2. Logged in, not admin → /
  //   3. Admin with stale TOTP → /auth/totp?next=<path>
  //
  // The in-route check in admin/page.tsx is kept as defense-in-depth
  // (e.g. middleware misconfig, matcher gap), but for the normal case
  // the user receives a 307 from edge before any HTML is sent.
  if (pathname.startsWith('/admin')) {
    if (!userData.user) {
      const target = new URL('/ingresar', request.url)
      target.searchParams.set('next', pathname + (request.nextUrl.search || ''))
      return NextResponse.redirect(target)
    }

    // Step 1 — confirm admin role. `is_admin` lives in the consolidated
    // profiles schema (002_core_tables.sql) so this query is always safe
    // regardless of which migrations have been applied to prod. Reads use
    // the anon-keyed supabase client which inherits the session cookie
    // above — RLS lets the user read their own row.
    const { data: roleProf } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', userData.user.id)
      .single()

    if (!roleProf?.is_admin) {
      // Non-admin (or profile fetch failed — be conservative). Bounce
      // to gateway, NOT /login (they're already authenticated).
      return NextResponse.redirect(new URL('/', request.url))
    }

    // Step 2 — TOTP enforcement, best-effort. The `totp_enabled` /
    // `last_totp_verified_at` cols come from a later migration,
    // which can lag the code deploy in prod. If the cols are
    // missing PostgREST returns 42703 (undefined_column) and the JS
    // SDK surfaces it as `error` with `data: null`. We let the admin
    // through without TOTP enforcement in that case — safe because
    // missing cols ⇔ TOTP can never have been enabled (the activation
    // endpoint also requires the cols to exist to UPDATE them). Once
    // the migration is applied this branch behaves like the original.
    //
    // A previous version selected all three cols in a single query;
    // when the cols were missing in prod, `data` was null and the
    // `!prof?.is_admin` check above redirected admins to `/`, breaking
    // the admin login. Lesson: Edge-runtime middleware queries fail on
    // missing cols, and fail-closed redirects lock admins out.
    const { data: totpProf, error: totpErr } = await supabase
      .from('profiles')
      .select('totp_enabled, last_totp_verified_at')
      .eq('id', userData.user.id)
      .single()

    if (!totpErr && totpProf?.totp_enabled) {
      const lastVerified = totpProf.last_totp_verified_at
        ? new Date(totpProf.last_totp_verified_at).getTime()
        : 0
      const stale = Date.now() - lastVerified > TOTP_VERIFY_TTL_MS
      if (stale) {
        const target = new URL('/auth/totp', request.url)
        target.searchParams.set('next', pathname + (request.nextUrl.search || ''))
        return NextResponse.redirect(target)
      }
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|blocked).*)'],
}
