import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/clients/require-user'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/ip'
import { verifyCode, verifyRecoveryCode } from '@/lib/totp'
import { logAudit } from '@/lib/auditLog'

export const runtime = 'nodejs'

/**
 * Re-verify an admin session against TOTP (or a recovery code). Bumps
 * `last_totp_verified_at` so the middleware admin-gate stops redirecting
 * /admin to /auth/totp for the next TOTP_VERIFY_TTL_MS window.
 *
 * Recovery codes are single-use — on match we splice the consumed hash
 * out of `totp_recovery_codes` and write the shorter array back. If
 * the user runs out, they re-roll the whole batch from /dashboard/security.
 *
 * Rate-limited per (user, IP) with the same bucket as /enable so a
 * brute-force across "I'm trying to verify" and "I'm trying to enable"
 * doesn't double the attacker's budget.
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

  const body = await req.json().catch(() => ({})) as {
    code?: unknown
    recoveryCode?: unknown
  }
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode.trim() : ''
  if (!code && !recoveryCode) {
    return NextResponse.json({ error: 'Código requerido' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('totp_secret, totp_enabled, totp_recovery_codes, is_admin')
    .eq('id', gate.userId)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!profile.totp_enabled || !profile.totp_secret) {
    return NextResponse.json({ error: 'TOTP no está activo' }, { status: 400 })
  }

  if (recoveryCode) {
    const matchedIdx = verifyRecoveryCode(recoveryCode, profile.totp_recovery_codes)
    if (matchedIdx < 0) {
      return NextResponse.json({ error: 'Código de recuperación inválido' }, { status: 401 })
    }
    // Single-use — drop the consumed hash and persist the shorter list.
    const remaining = (profile.totp_recovery_codes ?? []).filter((_: string, i: number) => i !== matchedIdx)
    await admin
      .from('profiles')
      .update({
        totp_recovery_codes: remaining,
        last_totp_verified_at: new Date().toISOString(),
      })
      .eq('id', gate.userId)
    await logAudit({ userId: gate.userId, action: 'totp_recovery_used' })
    return NextResponse.json({ ok: true, viaRecovery: true, remaining: remaining.length })
  }

  const delta = verifyCode(profile.totp_secret, code)
  if (delta === null) {
    return NextResponse.json({ error: 'Código inválido' }, { status: 401 })
  }

  await admin
    .from('profiles')
    .update({ last_totp_verified_at: new Date().toISOString() })
    .eq('id', gate.userId)

  return NextResponse.json({ ok: true })
}
