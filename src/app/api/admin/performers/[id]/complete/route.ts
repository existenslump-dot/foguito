import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { completePerformer } from '@/lib/performers'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/admin/performers/[id]/complete
 *
 * Admin-only: certify a collaborator's 2257 record (is_complete + dob_verified
 * = true). This is one of the ONLY two certification paths (the other is the
 * Didit webhook for the creator's OWN self record) — the creator-facing
 * /api/performers route NEVER certifies (INVARIANTE #1).
 *
 * Requires a FRESH admin TOTP — the same bar as the age-attestation / KYC
 * override, because certifying a 2257 record is what unblocks publishing the
 * associated content (content_publish_guard). The middleware's page-level TOTP
 * gate short-circuits on /api/*, so we enforce it here (fail-open when TOTP
 * isn't enabled, mirroring requireAdmin — never locks an admin out).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, { requireFreshTotp: true })
  if (!gate.ok) return gate.response

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id inválido (UUID esperado)' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const res = await completePerformer(admin, id)
  if (!res.ok) {
    const status = res.error === 'performer not found' ? 404 : 500
    return NextResponse.json({ error: res.error }, { status })
  }

  void recordAudit({
    eventType: 'performer_2257_completed',
    actorRole: 'admin',
    actorUserId: gate.userId,
    subjectType: 'performer',
    subjectId: id,
    req,
  })

  return NextResponse.json({ ok: true })
}
