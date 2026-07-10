import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from './supabase-admin'
import { isSameOrigin } from './same-origin'

/**
 * Resolve the current user from either an `Authorization: Bearer <access_token>`
 * header or the Supabase cookie session. Used by API routes that must not
 * trust a client-supplied `user_id` in the request body.
 *
 * Sister helper to `requireAdmin` — same resolution logic, no `is_admin` check.
 *
 * Same-origin guard: enabled by default. Mirrors `requireAdmin` so user-
 * scoped mutating endpoints can't be triggered cross-origin via XSS or a
 * future cookie policy regression. CLI / mobile callers without an Origin
 * header can opt out via `{ skipOriginCheck: true }`.
 *
 * Usage:
 *   export async function POST(req: NextRequest) {
 *     const gate = await requireUser(req)
 *     if (!gate.ok) return gate.response
 *     const { userId } = gate
 *     // ... use userId from the session, never from request body
 *   }
 */

type GateResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }

export type RequireUserOptions = {
  /** Bypass the same-origin check — reserve for callers that truly
   *  can't send an Origin header (mobile native, signed CLI, etc.).
   *  Document why at the call site. */
  skipOriginCheck?: boolean
}

export async function requireUser(
  req: Request,
  options?: RequireUserOptions,
): Promise<GateResult> {
  // Same-origin check fires before user resolution so a cross-origin
  // attacker doesn't trigger a Supabase round-trip.
  if (!options?.skipOriginCheck && !isSameOrigin(req)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid origin' }, { status: 403 }),
    }
  }

  const userId = await resolveUserId(req)

  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    }
  }

  return { ok: true, userId }
}

/**
 * Resolve the user if present, or return null. Use for endpoints that accept
 * anonymous traffic but still want to bind mutations to the session user
 * when one exists (e.g. reviews — anonymous comments are allowed, but a
 * logged-in user's reviewer_id must come from the session, not the body).
 */
export async function getOptionalUser(req: Request): Promise<string | null> {
  return resolveUserId(req)
}

async function resolveUserId(req: Request): Promise<string | null> {
  const admin = getSupabaseAdmin()

  // 1. Bearer token — preferred when the caller already holds an access token
  //    (e.g. client code posting from an authed page). Faster than the cookie
  //    round-trip and avoids reading cookies at all.
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const { data } = await admin.auth.getUser(token)
    if (data.user) return data.user.id
  }

  // 2. Fallback: cookie session via @supabase/ssr. This is the normal path
  //    for same-origin fetches from logged-in browser sessions.
  const cookieStore = await cookies()
  const supaUser = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const { data } = await supaUser.auth.getUser()
  return data.user?.id ?? null
}
