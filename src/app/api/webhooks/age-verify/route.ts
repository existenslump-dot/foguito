import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { verifyDiditWebhook } from '@/lib/didit/webhook-verify'
import { deriveAge } from '@/lib/didit/age'
import { extractIdVerification, mapStatus } from '@/lib/didit/mapping'
import type { DiditDecision } from '@/lib/didit/types'
import { ageVerifyWebhookSecret } from '@/lib/age-gate/config'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * POST /api/webhooks/age-verify
 *
 * The SOURCE OF TRUTH for a consumer age verification and the ONLY path that
 * writes a "verified" `age_gate_verifications` row (via the service-role
 * client — bypasses RLS; direct PostgREST inserts by the fan are blocked by the
 * admin-only `agegate_insert` policy). Molde: webhooks/didit.
 *
 * Flow:
 *   1. Read the RAW body before parsing (the HMAC covers the raw/canonical bytes).
 *   2. Verify the signature (v2 → simple → original) + timestamp freshness,
 *      reusing verifyDiditWebhook with AGE_VERIFY_WEBHOOK_SECRET. Only full-body
 *      signatures (v2/original) are APPLIED — 'simple' doesn't cover vendor_data.
 *   3. Dedup (age_verify_webhook_events, natural key) — Didit-style anti-replay.
 *   4. Derive ≥18 from the decision (reusing src/lib/didit/age.ts deriveAge) and,
 *      only if positive, INSERT the row with method/jurisdiction/verified_at/
 *      expires_at (90-day policy).
 *
 * PII MINIMIZATION (pilar #0): the DOB/name in the decision are used TRANSIENTLY
 * to derive the ≥18 verdict and then DISCARDED. We never persist DOB, name or
 * document data in age_gate_verifications — only the verdict + jurisdiction +
 * timing.
 *
 * Always 200 once processed (even on no-op) so the provider doesn't retry-storm;
 * 401 only on a bad signature; 500 on config/DB failure (there we want retries).
 */

const VERIFICATION_TTL_DAYS = 90

type AgeVerifyWebhookBody = {
  session_id?: string
  status?: string
  vendor_data?: string | null
  webhook_type?: string | null
  created_at?: number
  decision?: DiditDecision | null
  [k: string]: unknown
}

/**
 * Recovers the fan's user id AND the captured viewer jurisdiction from the
 * SIGNED `vendor_data` (encoded at start as JSON `{u,j}`). Both are covered by
 * the full-body HMAC, so they can't be forged. Falls back to treating a bare
 * string as the user id (no jurisdiction → we won't apply, see below).
 */
function decodeVendorData(v: unknown): { userId: string | null; jurisdiction: string | null } {
  if (typeof v !== 'string' || v.length === 0) return { userId: null, jurisdiction: null }
  try {
    const parsed = JSON.parse(v)
    if (parsed && typeof parsed === 'object') {
      const u = (parsed as Record<string, unknown>).u
      const j = (parsed as Record<string, unknown>).j
      return {
        userId: typeof u === 'string' && u ? u : null,
        jurisdiction: typeof j === 'string' && j ? j : null,
      }
    }
  } catch {
    // Not JSON — treat the whole value as a bare user id (no jurisdiction).
  }
  return { userId: v, jurisdiction: null }
}

export async function POST(req: Request) {
  const rawBody = await req.text()

  let body: AgeVerifyWebhookBody
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  let secret: string
  try {
    secret = ageVerifyWebhookSecret()
  } catch {
    console.error('[webhook/age-verify] AGE_VERIFY_WEBHOOK_SECRET not configured')
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
    console.error('[webhook/age-verify] signature rejected:', verdict.reason)
    return NextResponse.json({ error: verdict.reason }, { status: 401 })
  }

  // 'simple' signs only timestamp:session_id:status:webhook_type — it does NOT
  // cover vendor_data / decision, which is exactly what we're about to trust.
  // Authenticate it, but never APPLY it. 200 no-op so the provider doesn't retry.
  if (verdict.method === 'simple') {
    return NextResponse.json({ ok: true, skipped: 'simple_signature_scope' })
  }

  const { userId, jurisdiction } = decodeVendorData(body.vendor_data)
  // No user or no jurisdiction we can scope the proof to → nothing to apply.
  // Fail-closed: we do NOT write a verification we can't attribute + scope.
  if (!userId || !jurisdiction) {
    return NextResponse.json({ ok: true, skipped: 'missing_vendor_data' })
  }

  const admin = getSupabaseAdmin()

  // ── Replay / dedup guard (mirror of didit_webhook_events) ───────────────
  const eventCreatedAt =
    typeof body.created_at === 'number' && Number.isFinite(body.created_at) ? body.created_at : null
  let dedupInserted = false
  if (eventCreatedAt !== null) {
    const { error: dedupErr } = await admin.from('age_verify_webhook_events').insert({
      session_id: String(body.session_id ?? ''),
      status: String(body.status ?? ''),
      event_created_at: eventCreatedAt,
    })
    if (dedupErr) {
      if (dedupErr.code === '23505') {
        return NextResponse.json({ ok: true, deduped: true })
      }
      console.error('[webhook/age-verify] dedup insert failed:', dedupErr.message)
      return NextResponse.json({ error: 'dedup insert failed' }, { status: 500 })
    }
    dedupInserted = true
  }

  // Roll back the dedup marker (so a later genuine event can be re-processed)
  // whenever we bail out without persisting a verification.
  const rollbackDedup = async () => {
    if (dedupInserted && eventCreatedAt !== null) {
      await admin
        .from('age_verify_webhook_events')
        .delete()
        .eq('session_id', String(body.session_id ?? ''))
        .eq('status', String(body.status ?? ''))
        .eq('event_created_at', eventCreatedAt)
    }
  }

  // ── Derive the ≥18 verdict (fail-closed) ────────────────────────────────
  // Primary: DOB from the decision → deriveAge (reused from the KYC integration,
  // day-precision, fail-closed on missing/unparseable/future DOB).
  // Secondary: an explicit `age_over_18` boolean for pure age-estimation flows
  // that return no DOB.
  const internalStatus = mapStatus(body.status)
  const decision = (body.decision ?? body) as DiditDecision
  const idv = extractIdVerification(decision)
  const age = deriveAge(idv?.date_of_birth, new Date())
  const over18Flag = (decision as Record<string, unknown>).age_over_18 === true
  const verified = internalStatus === 'approved' && (age.ageVerified || over18Flag)

  if (!verified) {
    // Not a positive terminal result → no row. Allow reprocessing of a later
    // 'approved' event by releasing the dedup marker.
    await rollbackDedup()
    void recordAudit({
      eventType: 'age_verify_not_verified',
      actorRole: 'system',
      actorUserId: userId,
      subjectType: 'age_gate',
      subjectId: userId,
      req,
      metadata: {
        jurisdiction,
        didit_status: body.status ?? null,
        // reason only — never the DOB itself (PII is not persisted).
        age_reason: age.reason,
      },
    })
    return NextResponse.json({ ok: true, verified: false })
  }

  const nowIso = new Date().toISOString()
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  // Method: the real vendor that performed the verification (the configured
  // age-verify provider) — NEVER 'self_declared'.
  const method = process.env.NEXT_PUBLIC_AGE_VERIFY_PROVIDER || 'didit'

  const { error: insertErr } = await admin.from('age_gate_verifications').insert({
    user_id: userId,
    jurisdiction,
    method,
    verified_at: nowIso,
    expires_at: expiresAt,
  })
  if (insertErr) {
    await rollbackDedup()
    console.error('[webhook/age-verify] insert failed:', insertErr.message)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  void recordAudit({
    eventType: 'age_verify_verified',
    actorRole: 'system',
    actorUserId: userId,
    subjectType: 'age_gate',
    subjectId: userId,
    req,
    metadata: { jurisdiction, method, expires_at: expiresAt },
  })

  return NextResponse.json({ ok: true, verified: true })
}
