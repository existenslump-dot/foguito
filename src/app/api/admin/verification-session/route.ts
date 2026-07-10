import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { decryptJson } from '@/lib/didit/crypto'
import { extractIdVerification } from '@/lib/didit/mapping'
import type { DiditDecision } from '@/lib/didit/types'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/admin/verification-session?userId=<uuid>
 *
 * Admin-only: returns a user's latest Didit verification session.
 * `verification_sessions` is RLS deny-all (not even the admin reads it
 * directly), so this goes through the service role, same as /api/admin/identity-doc.
 *
 * Returns ONLY safe fields: status/scores/reason (from the clear columns) + the
 * data extracted from the document (decrypted from the payload server-side).
 * NEVER the encrypted blob or image URLs — those live in Didit's vault.
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.response

  const userId = (req.nextUrl.searchParams.get('userId') ?? '').trim()
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'Invalid userId (UUID expected)' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('verification_sessions')
    .select(
      'didit_session_id, status, decision, decline_reason, face_match_score, liveness_score, decision_payload_encrypted, last_webhook_at, created_at',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ session: null })
  }

  // Data extracted from the document: decrypt the payload server-side. If the
  // key is missing or decryption fails, we still return the operational metadata.
  let idVerification = null
  const blob = data.decision_payload_encrypted as string | null
  if (blob) {
    try {
      const payload = decryptJson<Record<string, unknown>>(blob)
      const decision = (payload.decision ?? payload) as DiditDecision
      idVerification = extractIdVerification(decision)
    } catch (e) {
      console.error('[verification-session] could not decrypt the payload:', e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({
    session: {
      didit_session_id: data.didit_session_id,
      status: data.status,
      decision: data.decision,
      decline_reason: data.decline_reason,
      face_match_score: data.face_match_score,
      liveness_score: data.liveness_score,
      last_webhook_at: data.last_webhook_at,
      created_at: data.created_at,
      id_verification: idVerification,
    },
  })
}
