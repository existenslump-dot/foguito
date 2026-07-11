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

  // The verdict we're about to apply TRUSTS vendor_data (the user id) and the
  // `decision` sub-object (the DOB → 18+ gate). Only the full-body signatures
  // ('v2'/'original') cover those bytes. The 'simple' signature covers ONLY
  // `timestamp:session_id:status:webhook_type` — a valid-simple event could
  // carry a forged vendor_data/decision (and its `created_at` freshness isn't
  // signed either). So: authenticate it, but never APPLY it. 200 no-op so Didit
  // doesn't retry-storm.
  if (verdict.method === 'simple') {
    console.warn('[webhook/didit] simple-signature only — verdict NOT applied (vendor_data/decision outside this signature scope)', {
      session_id: body.session_id,
      status: body.status,
    })
    return NextResponse.json({ ok: true, skipped: 'simple_signature_scope' })
  }

  const admin = getSupabaseAdmin()

  // ── Replay / dedup guard ───────────────────────────────────────────────
  // Freshness (300s) authenticates an event but doesn't stop the SAME event
  // from being processed twice (Didit retry, or a replay captured within the
  // window). Record the event's natural key BEFORE persisting; a PK conflict
  // (23505) means we already processed it → no-op. `created_at` is guaranteed
  // to be a finite number here (verifyDiditWebhook rejected it otherwise).
  const eventCreatedAt =
    typeof body.created_at === 'number' && Number.isFinite(body.created_at) ? body.created_at : null
  let dedupInserted = false
  if (eventCreatedAt !== null) {
    const { error: dedupErr } = await admin.from('didit_webhook_events').insert({
      session_id: String(body.session_id ?? ''),
      status: String(body.status ?? ''),
      event_created_at: eventCreatedAt,
    })
    if (dedupErr) {
      if (dedupErr.code === '23505') {
        return NextResponse.json({ ok: true, deduped: true })
      }
      console.error('[webhook/didit] dedup insert failed:', dedupErr.message)
      return NextResponse.json({ error: 'dedup insert failed' }, { status: 500 })
    }
    dedupInserted = true
  }

  const result = await persistDiditDecision(admin, body)
  if (!result.ok) {
    // Roll back the dedup marker so Didit's retry can re-process this event
    // (otherwise a transient persist failure would be silently dropped as a
    // "replay" on retry).
    if (dedupInserted && eventCreatedAt !== null) {
      await admin
        .from('didit_webhook_events')
        .delete()
        .eq('session_id', String(body.session_id ?? ''))
        .eq('status', String(body.status ?? ''))
        .eq('event_created_at', eventCreatedAt)
    }
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
