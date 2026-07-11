import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from './supabase-admin'
import { isSameOrigin } from './same-origin'

/**
 * Unified admin-gate for API routes.
 *
 * Accepts either a Supabase cookie session (the normal browser flow) or a
 * `Authorization: Bearer <access_token>` header (for fetches initiated from
 * client code holding the session token). Either way, the user must have
 * `profiles.is_admin = true`.
 *
 * By default also enforces same-origin on the request (Origin / Referer
 * must match a host the deployment serves — its own Host header, the
 * Vercel system domains or NEXT_PUBLIC_APP_URL; see same-origin.ts).
 * SameSite=lax already blocks the common CSRF vectors, but this layer
 * catches Bearer-via-XSS + future cookie policy regressions. CLI /
 * webhook callers that have no Origin header can opt out via
 * `{ skipOriginCheck: true }`.
 *
 * Usage:
 *   export async function POST(req: NextRequest) {
 *     const gate = await requireAdmin(req)
 *     if (!gate.ok) return gate.response
 *     const { userId } = gate
 *     // ... admin-only logic
 *   }
 *
 * Returns a discriminated union so TypeScript narrows `userId` correctly
 * on the happy path.
 */

type GateResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }

// Mirrors `TOTP_VERIFY_TTL_MS` in src/lib/totp.ts. Inlined (like src/middleware.ts
// does) so this module doesn't pull `otpauth` / `node:crypto` into every route
// that imports requireAdmin.
const TOTP_VERIFY_TTL_MS = 12 * 60 * 60 * 1000

export type RequireAdminOptions = {
  /** Bypass the same-origin check — reserve for callers that truly
   *  can't send an Origin header (CLI via shared secret, external
   *  webhook etc.). Document why at the call site. */
  skipOriginCheck?: boolean
  /** Also require a FRESH admin TOTP verification (within TOTP_VERIFY_TTL_MS).
   *  Reserve for high-sensitivity mutations that the middleware's page-level
   *  TOTP gate doesn't cover — the middleware short-circuits on `/api/*`, so a
   *  direct API call bypasses it. Fail-OPEN when TOTP isn't enabled or the
   *  `totp_*` cols are missing (schema lag), mirroring the middleware, so this
   *  can never lock an admin out. Only bites once the admin has 2FA enabled. */
  requireFreshTotp?: boolean
}

export async function requireAdmin(
  req: NextRequest,
  options?: RequireAdminOptions,
): Promise<GateResult> {
  // 0. Same-origin guard (unless the caller opts out). Runs first so
  // a cross-origin attacker doesn't even trigger a profile lookup.
  if (!options?.skipOriginCheck && !isSameOrigin(req)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid origin' }, { status: 403 }),
    }
  }

  const admin = getSupabaseAdmin()
  let userId: string | null = null

  // 1. Try Bearer token first — faster path, no cookie store read.
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const { data } = await admin.auth.getUser(token)
    if (data.user) userId = data.user.id
  }

  // 2. Fallback: cookie-based session via @supabase/ssr.
  if (!userId) {
    const cookieStore = await cookies()
    const supaUser = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } },
    )
    const { data } = await supaUser.auth.getUser()
    if (data.user) userId = data.user.id
  }

  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    }
  }

  // 3. Verify admin flag.
  const { data: profile, error } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .single()

  if (error || !profile?.is_admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }

  // 4. Optional fresh-TOTP gate for high-sensitivity mutations. Fail-open:
  //    only enforced when the admin has TOTP enabled and the cols exist (a
  //    42703 missing-column surfaces as `error` with null data → let through,
  //    same as the middleware). A stale (or never-verified) 2FA session is
  //    rejected with a machine-readable code so the client can bounce to
  //    /auth/totp.
  if (options?.requireFreshTotp) {
    const { data: totpProf, error: totpErr } = await admin
      .from('profiles')
      .select('totp_enabled, last_totp_verified_at')
      .eq('id', userId)
      .single()

    if (!totpErr && totpProf?.totp_enabled) {
      const lastVerified = totpProf.last_totp_verified_at
        ? new Date(totpProf.last_totp_verified_at).getTime()
        : 0
      const stale = Date.now() - lastVerified > TOTP_VERIFY_TTL_MS
      if (stale) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'Se requiere verificación 2FA reciente', code: 'totp_required' },
            { status: 403 },
          ),
        }
      }
    }
  }

  return { ok: true, userId }
}
