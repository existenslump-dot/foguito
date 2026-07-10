import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/clients/require-user'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/ip'
import { verifyCode } from '@/lib/totp'
import { logAudit } from '@/lib/auditLog'

export const runtime = 'nodejs'

/**
 * Disable TOTP for the current user. Requires a fresh, valid code from
 * the existing authenticator entry — without that, a stolen session
 * cookie would let an attacker turn off 2FA and lock the legitimate
 * admin out of recovery (since recovery codes only restore access, they
 * don't prove the holder still controls the original secret).
 *
 * Wipes secret + recovery codes + flips enabled=false in one atomic
 * UPDATE so a partial failure can't leave the row in a state where
 * verify still gates against an old secret but enabled is already off.
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
  if (!profile.totp_enabled || !profile.totp_secret) {
    return NextResponse.json({ ok: true, alreadyDisabled: true })
  }

  const delta = verifyCode(profile.totp_secret, code)
  if (delta === null) {
    return NextResponse.json({ error: 'Código inválido' }, { status: 401 })
  }

  const { error } = await admin
    .from('profiles')
    .update({
      totp_enabled: false,
      totp_secret: null,
      totp_recovery_codes: null,
      last_totp_verified_at: null,
    })
    .eq('id', gate.userId)

  if (error) {
    console.error('[totp/disable] persist failed', error)
    return NextResponse.json({ error: 'Disable failed' }, { status: 500 })
  }

  await logAudit({ userId: gate.userId, action: 'totp_disabled' })
  return NextResponse.json({ ok: true })
}
