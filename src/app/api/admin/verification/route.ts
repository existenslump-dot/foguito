import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { approveVerification, rejectVerification } from '@/lib/admin/actions'
import { recordAudit } from '@/lib/audit'

/**
 * POST /api/admin/verification
 *
 * Admin-only endpoint to approve/reject an identity verification.
 *
 * Why a server endpoint (and not a direct call from the client):
 *   `profiles` only has the RLS policy `profiles_update_own` (id = auth.uid()).
 *   There is NO admin UPDATE policy, so an admin updating ANOTHER user's
 *   profile from the browser client matches 0 rows — approveVerification /
 *   rejectVerification report it as "insufficient permissions". The
 *   service-role client bypasses RLS, centralizing admin writes in a single
 *   admin-gated endpoint.
 *
 * Body: { profileId: uuid, action: 'approve' | 'reject', reason?: string }
 */

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  try {
    // Parse the body BEFORE the gate so we know whether this is an age
    // attestation (which raises the bar to fresh-TOTP). requireAdmin only reads
    // headers/cookies, so consuming the body first is safe.
    const body = await req.json().catch(() => null) as
      | { profileId?: string; action?: string; reason?: string; ageAttested?: boolean }
      | null
    const profileId = String(body?.profileId ?? '').trim()
    const action = String(body?.action ?? '').trim()

    // Manually attesting 18+ sets creators.age_verified=true, which alone
    // unlocks publishing (bypassing the DOB-derived Didit path). Gate it behind
    // a fresh admin 2FA re-verify — the middleware's page-level TOTP gate does
    // NOT cover direct `/api/admin/*` calls. (Computing this boolean leaks
    // nothing; no validation error is emitted before the gate.)
    const ageAttesting = action === 'approve' && body?.ageAttested === true
    const gate = await requireAdmin(req, { requireFreshTotp: ageAttesting })
    if (!gate.ok) return gate.response

    if (!UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId inválido (UUID esperado)' }, { status: 400 })
    }

    if (body?.ageAttested !== undefined && typeof body.ageAttested !== 'boolean') {
      return NextResponse.json({ error: 'ageAttested debe ser boolean' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()

    if (action === 'approve') {
      const result = await approveVerification(admin, profileId, { ageAttested: body?.ageAttested === true })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
      // Explicit audit when 18+ is set by manual attestation (no DOB signal) —
      // actor is the admin, subject is the attested profile/creator.
      if (ageAttesting) {
        void recordAudit({
          eventType: 'creator_age_attested',
          actorRole: 'admin',
          actorUserId: gate.userId,
          subjectType: 'creator',
          subjectId: profileId,
          req,
          metadata: { via: 'admin_manual_attestation' },
        })
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'reject') {
      const reason = String(body?.reason ?? '').trim()
      if (!reason) {
        return NextResponse.json({ error: 'El motivo de rechazo es requerido' }, { status: 400 })
      }
      const result = await rejectVerification(admin, profileId, reason)
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'action inválida (approve | reject)' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'Error desconocido',
    }, { status: 500 })
  }
}
