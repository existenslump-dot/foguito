import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { verifyDiditWebhook } from '@/lib/didit/webhook-verify'
import { persistDiditDecision, type DiditWebhookBody } from '@/lib/didit/sessions'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * POST /api/webhooks/didit
 *
 * Didit webhook — the SOURCE OF TRUTH for the verification result. It does not
 * use requireAdmin (it's an external caller): authenticity comes from the HMAC
 * signature.
 *
 * Flow:
 *   1. Read the RAW body BEFORE parsing (the signature is computed over the raw
 *      bytes / canonical JSON — re-stringifying would break verification).
 *   2. Verify the signature (x-signature-v2 → x-signature-simple → x-signature)
 *      + timestamp freshness (body.created_at, 300 s window).
 *   3. Persist (encrypted) + map to profiles/posts (idempotent, out-of-order
 *      safe).
 *
 * Always 200 once processed (even with no change) so we don't trigger Didit's
 * retry storm. 401 only if the signature doesn't validate; 500 if config or the
 * DB fails (there we DO want the retry).
 */
export async function POST(req: Request) {
  const rawBody = await req.text()

  let body: DiditWebhookBody
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const secret = process.env.DIDIT_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhook/didit] DIDIT_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'not configured' }, { status: 500 })
  }

  const verdict = verifyDiditWebhook({
    rawBody,
    body: body as Record<string, unknown>,
    signatures: {
      v2: req.headers.get('x-signature-v2'),
      simple: req.headers.get('x-signature-simple'),
      original: req.headers.get('x-signature'),
    },
    secret,
  })
  if (!verdict.ok) {
    console.error('[webhook/didit] signature rejected:', verdict.reason)
    return NextResponse.json({ error: verdict.reason }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  const result = await persistDiditDecision(admin, body)
  if (!result.ok) {
    console.error('[webhook/didit] persistence failed:', result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  // Fire-and-forget audit (does not block the webhook response).
  void recordAudit({
    eventType: `kyc_didit_${result.data.internalStatus}`,
    actorRole: 'user',
    actorUserId: result.data.userId,
    subjectType: 'verification',
    subjectId: result.data.userId,
    req,
    metadata: {
      didit_session_id: body.session_id,
      didit_status: body.status,
      method: verdict.method,
      applied: result.data.applied,
      stale: result.data.stale,
    },
  })

  return NextResponse.json({ ok: true, status: result.data.internalStatus })
}
