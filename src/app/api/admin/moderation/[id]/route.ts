import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/admin/moderation/[id]
 *
 * Admin-only (FRESH TOTP): resuelve una queja de `moderation_events`. `id` es el
 * id de la QUEJA, no del contenido. Body `{ action }` ∈ `takedown | dismiss`.
 *
 * ┌── takedown ────────────────────────────────────────────────────────────────┐
 * │ Bajar contenido publicado es alta-sensibilidad → `requireFreshTotp`. Setea  │
 * │ `content.status='removed'` (service-role) — de ahí la propagación la hacen  │
 * │ la RLS `content_select` + los guards de PR-5 (cortan la entrega ANTES del   │
 * │ check de entitlement). NO se revoca entitlement, NO se purga data, NO se     │
 * │ invalida cache, y JAMÁS se toca 2257/CSAM (retención legal independiente).  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Idempotente: una queja ya resuelta (`actioned`/`dismissed`) devuelve 200
 * `already_resolved` sin re-actuar. `csam_suspected` igual baja el contenido,
 * pero el audit marca `escalate_csam:true` — el manejo real del CSAM sigue el
 * pipeline OBLIGATORIO de NCMEC (existente), no esta ruta genérica.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Bajar contenido publicado = alta-sensibilidad: 2FA ENROLADA (fail-CLOSED) además
  // de fresca. Un admin sin 2FA enrolada no puede ejecutar takedown/dismiss.
  const gate = await requireAdmin(req, { requireFreshTotp: true, requireTotpEnrolled: true })
  if (!gate.ok) return gate.response

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id inválido (UUID esperado)' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({} as { action?: string }))
  const action = body?.action
  if (action !== 'takedown' && action !== 'dismiss') {
    return NextResponse.json({ error: 'action inválida (takedown | dismiss)' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  const { data: complaint, error: loadErr } = await admin
    .from('moderation_events')
    .select('id, content_id, category, status')
    .eq('id', id)
    .maybeSingle<{ id: string; content_id: string | null; category: string; status: string }>()

  if (loadErr) return NextResponse.json({ error: 'error' }, { status: 500 })
  if (!complaint) return NextResponse.json({ error: 'queja no encontrada' }, { status: 404 })

  // Idempotencia: ya resuelta ⇒ no re-actuamos (no re-bajamos ni re-auditamos).
  if (complaint.status === 'actioned' || complaint.status === 'dismissed') {
    return NextResponse.json({ ok: true, status: 'already_resolved' })
  }

  const nowIso = new Date().toISOString()
  const contentId = complaint.content_id
  const isCsam = complaint.category === 'csam_suspected'

  if (action === 'takedown') {
    // 1. Bajar el contenido (si sigue referenciado). status='removed' es la ÚNICA
    //    propagación necesaria — no dispara content_publish_guard.
    if (contentId) {
      const { error: rmErr } = await admin
        .from('content')
        .update({ status: 'removed' })
        .eq('id', contentId)
      if (rmErr) return NextResponse.json({ error: 'error' }, { status: 500 })
    }

    // 2. Resolver la queja.
    const { error: resErr } = await admin
      .from('moderation_events')
      .update({
        status:      'actioned',
        resolution:  'takedown',
        resolved_by: gate.userId,
        resolved_at: nowIso,
      })
      .eq('id', id)
    if (resErr) return NextResponse.json({ error: 'error' }, { status: 500 })

    void recordAudit({
      eventType:   'takedown_executed',
      actorRole:   'admin',
      actorUserId: gate.userId,
      subjectType: 'content',
      subjectId:   contentId,
      req,
      metadata: {
        complaint_id: id,
        category:     complaint.category,
        // CSAM: el contenido baja igual, pero se marca para el pipeline NCMEC.
        ...(isCsam ? { escalate_csam: true } : {}),
      },
    })

    return NextResponse.json({ ok: true, status: 'actioned', resolution: 'takedown' })
  }

  // dismiss
  const { error: disErr } = await admin
    .from('moderation_events')
    .update({
      status:      'dismissed',
      resolution:  'dismissed',
      resolved_by: gate.userId,
      resolved_at: nowIso,
    })
    .eq('id', id)
  if (disErr) return NextResponse.json({ error: 'error' }, { status: 500 })

  void recordAudit({
    eventType:   'complaint_dismissed',
    actorRole:   'admin',
    actorUserId: gate.userId,
    subjectType: 'content',
    subjectId:   contentId,
    req,
    metadata:    { complaint_id: id, category: complaint.category },
  })

  return NextResponse.json({ ok: true, status: 'dismissed', resolution: 'dismissed' })
}
