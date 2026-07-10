import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { AuthCheckAvailabilitySchema, validationError } from '@/lib/validation/schemas'

export const runtime = 'nodejs'

/**
 * Pre-signup availability check.
 *
 * Replaces the previous client-side query from /registro that distinguished
 * "email already registered" vs "phone already registered" — that wording
 * is an enumeration vector, letting an attacker probe which emails are
 * registered by submitting fresh phones (or vice versa).
 *
 * Design:
 * - The response is always `{ available: boolean }` — never reveals which
 *   field collided. Client shows a unified "email o teléfono ya registrado"
 *   message if `available === false`.
 * - Uses the admin client so we don't depend on a permissive anon SELECT
 *   policy on `profiles`. Defense in depth if RLS tightens later.
 * - Middleware's /api/auth/* rule (10 req / 15 min per IP) already caps
 *   probe velocity. The auth gate (/api/auth/gate) applies per-email
 *   on top of that for login/registro submits.
 */
export async function POST(req: Request) {
  try {
    const parsed = AuthCheckAvailabilitySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 })
    }
    const { email, phone } = parsed.data

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .or(`email.eq.${email},phone.eq.${phone}`)
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[auth-check-availability] query failed', error)
      // Fail-open: letting a registration attempt proceed on a transient
      // DB blip is less bad than blocking new users entirely. Supabase
      // itself will reject the eventual signUp if the email truly exists.
      return NextResponse.json({ available: true, warning: 'check-skipped' })
    }

    return NextResponse.json({ available: !data })
  } catch (err) {
    console.error('[auth-check-availability] unexpected error', err)
    return NextResponse.json({ available: true, warning: 'check-skipped' })
  }
}
