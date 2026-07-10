import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/clients/require-user'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { isDiditEnabled, diditWorkflowId } from '@/lib/didit/config'
import { createSession } from '@/lib/didit/client'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * GET  /api/verification/didit-session  → { enabled }
 *   Reports whether automated verification is configured. The verification page
 *   uses it to show (or not) the Didit CTA. Reveals no secrets.
 *
 * POST /api/verification/didit-session  → { url }
 *   Creates a verification session for the logged-in user and returns Didit's
 *   hosted URL to redirect to. `vendor_data` = userId (recovered in the
 *   webhook). Persists a 'created' row in verification_sessions so there is a
 *   record before the first webhook arrives.
 */

export async function GET() {
  return NextResponse.json({ enabled: isDiditEnabled() })
}

export async function POST(req: NextRequest) {
  if (!isDiditEnabled()) {
    return NextResponse.json({ error: 'Automated verification is not available' }, { status: 503 })
  }

  const gate = await requireUser(req)
  if (!gate.ok) return gate.response
  const { userId } = gate

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  const callback = `${appUrl}/dashboard/verify?didit=return`

  const session = await createSession({
    vendorData: userId,
    callback,
  })
  if (!session.ok) {
    console.error('[didit-session] createSession failed:', session.error)
    return NextResponse.json({ error: 'Could not start verification' }, { status: 502 })
  }

  // Session record (status 'created'). The webhook updates it by
  // didit_session_id (onConflict). Best-effort: if it fails we still return the
  // URL — the webhook can create the row later.
  const admin = getSupabaseAdmin()
  const { error: insertErr } = await admin.from('verification_sessions').insert({
    user_id: userId,
    provider: 'didit',
    didit_session_id: session.data.session_id,
    didit_workflow_id: diditWorkflowId(),
    status: 'created',
  })
  if (insertErr) {
    console.error('[didit-session] verification_sessions insert failed (non-fatal):', insertErr.message)
  }

  void recordAudit({
    eventType: 'kyc_didit_session_started',
    actorRole: 'user',
    actorUserId: userId,
    subjectType: 'verification',
    subjectId: userId,
    req,
    metadata: { didit_session_id: session.data.session_id },
  })

  return NextResponse.json({ url: session.data.url })
}
