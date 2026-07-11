import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/admin/content/[id]/reject
 *
 * Admin-only: reject a content draft (status='rejected') or take down a piece
 * (status='removed', via body `{ "removed": true }`). Neither status trips
 * content_publish_guard (it only fires on the transition to 'published'), so
 * this is a plain service-role update.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.response

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id inválido (UUID esperado)' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({} as { removed?: boolean }))
  const status = body?.removed === true ? 'removed' : 'rejected'

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('content')
    .update({ status })
    .eq('id', id)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'content no encontrado' }, { status: 404 })
  }

  void recordAudit({
    eventType: status === 'removed' ? 'content_removed' : 'content_rejected',
    actorRole: 'admin',
    actorUserId: gate.userId,
    subjectType: 'content',
    subjectId: id,
    req,
  })

  return NextResponse.json({ ok: true, status })
}
