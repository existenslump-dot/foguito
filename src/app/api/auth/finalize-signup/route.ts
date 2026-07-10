import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/clients/require-user'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { FinalizeSignupSchema, validationError } from '@/lib/validation/schemas'
import { getClientIp } from '@/lib/ip'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * Why server-side: the client must not be trusted to send its own IP.
 * Browsers can't read the original public IP reliably (NAT/proxy), and a
 * malicious client could just falsify it. Capturing it here from
 * x-forwarded-for (set by Vercel's edge proxy) is the only defensible
 * record for audit trail.
 *
 * Idempotency: signup-context UPDATEs use COALESCE-style logic — fields
 * already set are NOT overwritten. A user who refreshes /registro after
 * signUp + re-submits won't get a fresh IP/timestamp clobbering the
 * original record.
 */
export async function POST(req: Request) {
  const gate = await requireUser(req)
  if (!gate.ok) return gate.response
  const { userId } = gate

  const parsed = FinalizeSignupSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(validationError(parsed.error), { status: 400 })
  }
  const {
    context,
    terms_accepted,
    privacy_accepted,
  } = parsed.data

  const ip = getClientIp(req)
  const now = new Date().toISOString()
  const admin = getSupabaseAdmin()

  if (context === 'signup') {
    // Only write the timestamps the user actually clicked. Bool=false
    // means the user didn't tick that box — don't persist a false consent.
    // The /registro form rejects submission unless the required boxes are
    // ticked; this is defense-in-depth for any future caller that might submit
    // a partial set.
    if (!terms_accepted || !privacy_accepted) {
      return NextResponse.json(
        { error: 'Signup requires terms and privacy declarations' },
        { status: 400 },
      )
    }

    // Fetch current state to apply COALESCE semantics — only write if NULL.
    const { data: existing, error: fetchErr } = await admin
      .from('profiles')
      .select('terms_accepted_at, terms_accepted_ip, registration_ip, privacy_accepted_at')
      .eq('id', userId)
      .single()

    if (fetchErr) {
      console.error('[finalize-signup] fetch failed', { userId, error: fetchErr })
      return NextResponse.json({ error: 'Could not load profile' }, { status: 500 })
    }

    const update: Record<string, string> = {}
    if (!existing?.terms_accepted_at)              update.terms_accepted_at              = now
    if (!existing?.terms_accepted_ip)              update.terms_accepted_ip              = ip
    if (!existing?.registration_ip)                update.registration_ip                = ip
    // /registro already PATCHes privacy_accepted_at client-side, but keep
    // a server-side fallback for the case where the client PATCH fails
    // (RLS hiccup, transient network). Idempotent same as the others.
    if (!existing?.privacy_accepted_at)            update.privacy_accepted_at            = now

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: true, already_finalized: true })
    }

    const { error: updErr } = await admin
      .from('profiles')
      .update(update)
      .eq('id', userId)

    if (updErr) {
      console.error('[finalize-signup] update failed', { userId, error: updErr })
      return NextResponse.json({ error: 'Could not finalize signup' }, { status: 500 })
    }

    void recordAudit({
      eventType: 'signup',
      actorRole: 'user',
      actorUserId: userId,
      subjectType: 'profile',
      subjectId: userId,
      req,
      ip,
      metadata: { fields_written: Object.keys(update) },
    })

    return NextResponse.json({ ok: true, fields_written: Object.keys(update) })
  }

  const verifyUpdate: Record<string, string> = {
    kyc_submitted_ip: ip,
  }

  const { error: verifyErr } = await admin
    .from('profiles')
    .update(verifyUpdate)
    .eq('id', userId)

  if (verifyErr) {
    console.error('[finalize-signup] verify-context update failed', { userId, error: verifyErr })
    return NextResponse.json({ error: 'Could not record verification declaration' }, { status: 500 })
  }

  void recordAudit({
    eventType: 'kyc_submitted',
    actorRole: 'user',
    actorUserId: userId,
    subjectType: 'profile',
    subjectId: userId,
    req,
    ip,
  })

  return NextResponse.json({ ok: true, context: 'verify', timestamp: now })
}
