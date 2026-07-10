import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { approveVerification, rejectVerification } from '@/lib/admin/actions'

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
    const gate = await requireAdmin(req)
    if (!gate.ok) return gate.response

    const body = await req.json().catch(() => null) as
      | { profileId?: string; action?: string; reason?: string }
      | null
    const profileId = String(body?.profileId ?? '').trim()
    const action = String(body?.action ?? '').trim()

    if (!UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId inválido (UUID esperado)' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()

    if (action === 'approve') {
      const result = await approveVerification(admin, profileId)
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
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
