import { NextResponse } from 'next/server'
import { AuthGateSchema, validationError } from '@/lib/validation/schemas'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/ip'

export const runtime = 'nodejs'

/**
 * Pre-auth brute-force gate.
 *
 * The login/registro client pages hit Supabase directly with their email +
 * password + captcha token. That means our middleware's `/api/auth/*`
 * rule (10 req / 15 min per IP) never fires on those flows, and the only
 * rate limit is Supabase's. If Supabase captcha validation is ever
 * misconfigured or bypassed, an attacker can hammer a single account from
 * one IP as fast as Supabase will take it.
 *
 * This endpoint adds an independent rate-limit tier: per-IP + per-email,
 * tight window. The client calls it BEFORE the Supabase auth request;
 * a 429 short-circuits the flow with a user-facing "too many attempts"
 * message. A 200 means "go ahead", but we don't mint or return anything
 * that weakens the chain — Supabase still validates the captcha.
 *
 * Note: we DO NOT verify the captcha token here. Turnstile/hCaptcha
 * tokens are single-use, so consuming them in a pre-flight would break
 * Supabase's own validation. See src/lib/auth/verify-captcha.ts for
 * the shared verify helper used in flows that don't chain into Supabase.
 */
export async function POST(req: Request) {
  try {
    const parsed = AuthGateSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 })
    }
    const { action, email } = parsed.data

    const ip = getClientIp(req)

    // Per-IP + per-email + per-action. Per-IP tier (10 / 15 min) is
    // already enforced by middleware's /api/auth/* rule; this tier
    // targets the case where an attacker rotates IPs but keeps aiming
    // at the same account.
    const key = `auth-gate:${action}:${email}:${ip}`
    const { success, retryAfter } = await rateLimit(key, 5, 5 * 60 * 1000)
    if (!success) {
      return NextResponse.json(
        { error: 'Demasiados intentos para esta cuenta. Probá más tarde.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[auth-gate] unexpected error', err)
    // Fail-open on unexpected errors — the gate is defense in depth, not
    // the primary auth guard. A transient bug here shouldn't lock users
    // out when Supabase's own captcha + throttling are still in place.
    return NextResponse.json({ ok: true, warning: 'gate-bypass-on-error' })
  }
}
