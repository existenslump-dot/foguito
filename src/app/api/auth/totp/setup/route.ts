import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { requireUser } from '@/lib/clients/require-user'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import {
  generateSecret,
  otpauthUri,
  generateRecoveryCodes,
  hashRecoveryCode,
} from '@/lib/totp'

export const runtime = 'nodejs'

/**
 * Initialise a TOTP setup. Returns the otpauth URI + a QR data URL the
 * client can show to the user, plus a fresh batch of recovery codes
 * (plaintext, single one-time display).
 *
 * Stores the new secret + hashed recovery codes on the profile WITHOUT
 * flipping `totp_enabled` — that only happens after `/api/auth/totp/enable`
 * receives a valid code, proving the user actually scanned the QR. This
 * way a half-finished setup doesn't lock the user out of /admin.
 *
 * Calling this on a profile that already has TOTP enabled rotates the
 * secret + codes — same as a fresh setup, but the flow that consumes
 * the response should warn the user that their old authenticator entry
 * stops working immediately.
 */
export async function POST(req: NextRequest) {
  const gate = await requireUser(req)
  if (!gate.ok) return gate.response

  const admin = getSupabaseAdmin()

  // Look up the user's email so the otpauth URI carries a meaningful
  // label in the authenticator app (e.g. "MARKETPLACE+: admin@example.com").
  const { data: profile } = await admin
    .from('profiles')
    .select('email, is_admin')
    .eq('id', gate.userId)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const secret = generateSecret()
  const accountLabel = profile.email ?? gate.userId
  const uri = otpauthUri(secret, accountLabel)
  const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 })

  const recoveryCodes = generateRecoveryCodes(8)
  const recoveryHashes = recoveryCodes.map(hashRecoveryCode)

  // Persist secret + hashed codes but leave `totp_enabled` untouched.
  // If the user abandons the setup, the next call to /setup overwrites
  // the secret cleanly — no orphan state.
  const { error } = await admin
    .from('profiles')
    .update({
      totp_secret: secret,
      totp_recovery_codes: recoveryHashes,
    })
    .eq('id', gate.userId)

  if (error) {
    console.error('[totp/setup] persist failed', error)
    return NextResponse.json({ error: 'Setup failed' }, { status: 500 })
  }

  return NextResponse.json({
    otpauthUri: uri,
    qrDataUrl,
    recoveryCodes,
  })
}
