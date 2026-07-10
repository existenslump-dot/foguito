import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/clients/require-user'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/ip'
import { verifyCode } from '@/lib/totp'

export const runtime = 'nodejs'

/**
 * Confirm a TOTP setup by validating a code generated from the freshly
 * stored secret. Flips `totp_enabled = true` and records
 * `last_totp_verified_at = now()` so the user lands inside the
 * re-verification window without an extra prompt.
 *
 * Rate-limited per IP — 10 attempts / 5 min — to bound a brute-force
 * window if the user's session cookie is stolen during setup. Same
 * bucket keys as /verify so the limits accumulate across both flows.
 */
export async function POST(req: NextRequest) {
  const gate = await requireUser(req)
  if (!gate.ok) return gate.response

  const ip = getClientIp(req)
  const rl = await rateLimit(`totp-attempt:${gate.userId}:${ip}`, 10, 5 * 60 * 1000)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Probá en unos minutos.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const body = await req.json().catch(() => ({})) as { code?: unknown }
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!code) {
    return NextResponse.json({ error: 'Código requerido' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('totp_secret, totp_enabled, is_admin')
    .eq('id', gate.userId)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!profile.totp_secret) {
    return NextResponse.json({ error: 'Iniciá el setup primero' }, { status: 400 })
  }
  if (profile.totp_enabled) {
    // Idempotent — re-enabling a session that already has TOTP active
    // shouldn't fail loud. The verify code still has to match so this
    // doesn't bypass anything.
    const delta = verifyCode(profile.totp_secret, code)
    if (delta === null) {
      return NextResponse.json({ error: 'Código inválido' }, { status: 401 })
    }
    await admin
      .from('profiles')
      .update({ last_totp_verified_at: new Date().toISOString() })
      .eq('id', gate.userId)
    return NextResponse.json({ ok: true, alreadyEnabled: true })
  }

  const delta = verifyCode(profile.totp_secret, code)
  if (delta === null) {
    return NextResponse.json({ error: 'Código inválido' }, { status: 401 })
  }

  const { error } = await admin
    .from('profiles')
    .update({
      totp_enabled: true,
      last_totp_verified_at: new Date().toISOString(),
    })
    .eq('id', gate.userId)

  if (error) {
    console.error('[totp/enable] persist failed', error)
    return NextResponse.json({ error: 'Activation failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
