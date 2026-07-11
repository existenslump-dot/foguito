import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/admin/content/[id]/publish
 *
 * Admin-only (FRESH TOTP): move a content row to status='published'.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ The DB is the AUTHORITY. This route does NOT re-implement the publish       │
 * │ rules — it just issues the UPDATE and lets `content_publish_guard`          │
 * │ (SECURITY DEFINER) throw if the piece isn't publishable: CSAM not passed,   │
 * │ creator not verified 18+, or a performer's 2257 record incomplete. Until    │
 * │ the CSAM scanner (PR-3) flips csam_status='pass', EVERY publish here will   │
 * │ (correctly) be blocked — we translate the check_violation into a readable   │
 * │ message. We NEVER set csam_status='pass' by hand (that's PR-3, the scanner).│
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Fresh TOTP: publishing is what makes content go live — same high bar as the
 * 2257 certification / KYC override. The middleware's page-level TOTP gate
 * short-circuits on /api/*, so we enforce it here (fail-open when TOTP isn't
 * enabled, mirroring requireAdmin — never locks an admin out).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, { requireFreshTotp: true })
  if (!gate.ok) return gate.response

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id inválido (UUID esperado)' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  void recordAudit({
    eventType: 'content_publish_attempt',
    actorRole: 'admin',
    actorUserId: gate.userId,
    subjectType: 'content',
    subjectId: id,
    req,
  })

  const { data, error } = await admin
    .from('content')
    .update({ status: 'published' })
    .eq('id', id)
    .select('id, status')

  if (error) {
    // content_publish_guard raises with ERRCODE check_violation (23514). Any
    // guard failure (CSAM pending / creator unverified / 2257 incomplete) lands
    // here — surface a legible reason instead of a raw Postgres error.
    const guardHit =
      error.code === '23514' ||
      /content_publish_guard|csam|2257|verificada/i.test(error.message ?? '')
    if (guardHit) {
      return NextResponse.json(
        { error: 'Publicación bloqueada: CSAM pendiente o 2257/verificación 18+ incompletos.', detail: error.message },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'content no encontrado' }, { status: 404 })
  }

  void recordAudit({
    eventType: 'content_published',
    actorRole: 'admin',
    actorUserId: gate.userId,
    subjectType: 'content',
    subjectId: id,
    req,
  })

  return NextResponse.json({ ok: true, status: 'published' })
}
