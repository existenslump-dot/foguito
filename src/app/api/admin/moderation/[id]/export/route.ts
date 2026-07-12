import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/admin/moderation/[id]/export
 *
 * Admin-only (FRESH TOTP): arma un registro estructurado para cooperación con
 * autoridad / regulador a partir de UNA queja (`id` = moderation_events.id).
 *
 * ┌── INVARIANTE ABSOLUTA: REFERENCIAS, NUNCA CONTENIDO SENSIBLE ──────────────┐
 * │ · media: se incluye `media_ref` como PATH (string), NUNCA firmado ni los    │
 * │   bytes. Sin URLs firmadas a buckets privados inline.                       │
 * │ · 2257: referencias a `performers_2257` (id, id_doc_path=PATH, custodio,    │
 * │   added_by, is_complete) — JAMÁS el `legal_name_enc` (cifrado por la app;   │
 * │   descifrar es un paso aparte de mayor privilegio) ni los bytes del doc.    │
 * │ · trail: el slice de `audit_log` para subject_id = content_id.              │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Si la categoría es `csam_suspected`, el registro lleva un flag PROMINENTE:
 * el CSAM va por el pipeline OBLIGATORIO de NCMEC, NO por este export genérico.
 * Marca `authority_export_status='generated'` en la queja + auditoría.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Superficie de mayor PII del PR (referencias 2257 + trail + IPs de reporters):
  // 2FA ENROLADA (fail-CLOSED) además de fresca. Un admin sin 2FA no exporta.
  const gate = await requireAdmin(req, { requireFreshTotp: true, requireTotpEnrolled: true })
  if (!gate.ok) return gate.response

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id inválido (UUID esperado)' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  const { data: complaint } = await admin
    .from('moderation_events')
    .select(
      'id, content_id, creator_id, reporter_user_id, reporter_ip, category, description, status, sla_due_at, resolution, resolved_by, resolved_at, authority_export_status, created_at',
    )
    .eq('id', id)
    .maybeSingle<{ id: string; content_id: string | null; creator_id: string | null; category: string }>()

  if (!complaint) {
    return NextResponse.json({ error: 'queja no encontrada' }, { status: 404 })
  }

  const contentId = complaint.content_id

  // Referencia al contenido — `media_ref` es el PATH crudo, NUNCA firmado/bytes.
  let contentRef: Record<string, unknown> | null = null
  // Todas las quejas de esa pieza (contexto para la autoridad).
  let complaintsForContent: unknown[] = [complaint]
  // Referencias 2257 — SIN `legal_name_enc`, SIN bytes del documento.
  let performerRefs: unknown[] = []
  // Slice del audit_log (el trail).
  let auditTrail: unknown[] = []

  if (contentId) {
    const { data: c } = await admin
      .from('content')
      .select('id, status, created_at, published_at, media_ref, media_type, visibility, csam_status')
      .eq('id', contentId)
      .maybeSingle()
    contentRef = (c as Record<string, unknown> | null) ?? null

    const { data: allComplaints } = await admin
      .from('moderation_events')
      .select(
        'id, content_id, creator_id, reporter_user_id, reporter_ip, category, description, status, sla_due_at, resolution, resolved_by, resolved_at, authority_export_status, created_at',
      )
      .eq('content_id', contentId)
      .order('created_at', { ascending: true })
    if (allComplaints && allComplaints.length > 0) complaintsForContent = allComplaints

    // content_performers → performers_2257 REFERENCES. legal_name_enc EXCLUIDO
    // a propósito del select (no se descifra ni se filtra el cifrado).
    const { data: links } = await admin
      .from('content_performers')
      .select('performer_id')
      .eq('content_id', contentId)
    const performerIds = [
      ...new Set(
        (links ?? [])
          .map((l) => (l as { performer_id?: string }).performer_id)
          .filter((x): x is string => Boolean(x)),
      ),
    ]
    if (performerIds.length > 0) {
      const { data: perfs } = await admin
        .from('performers_2257')
        .select('id, id_doc_path, custodian, added_by, is_complete, dob_verified, created_at')
        .in('id', performerIds)
      performerRefs = perfs ?? []
    }

    // El trail del contenido: audit_log.subject_id se guarda como TEXT = content id.
    const { data: audit } = await admin
      .from('audit_log')
      .select('id, event_type, actor_role, actor_user_id, subject_type, subject_id, ip, metadata, created_at')
      .eq('subject_id', contentId)
      .order('created_at', { ascending: true })
    auditTrail = audit ?? []
  }

  // Marca la queja como exportada (idempotente — 'none' → 'generated').
  await admin
    .from('moderation_events')
    .update({ authority_export_status: 'generated' })
    .eq('id', id)

  void recordAudit({
    eventType:   'authority_export_generated',
    actorRole:   'admin',
    actorUserId: gate.userId,
    subjectType: 'content',
    subjectId:   contentId,
    req,
    metadata:    { complaint_id: id, category: complaint.category },
  })

  const isCsam = complaint.category === 'csam_suspected'

  const record = {
    export_kind: 'authority_cooperation',
    references_only: true,
    generated_at: new Date().toISOString(),
    generated_by: gate.userId,
    // Aviso PROMINENTE para CSAM: no se maneja por este export genérico.
    csam_mandatory_ncmec: isCsam
      ? 'ADVERTENCIA: queja CSAM. El material de abuso sexual infantil se maneja por el pipeline OBLIGATORIO de reporte a NCMEC, NO por este export genérico. Este registro es sólo referencial.'
      : null,
    complaint,
    content: contentRef, // referencias: media_ref es un PATH, nunca firmado/bytes
    complaints_for_content: complaintsForContent,
    performers_2257_references: performerRefs, // sin legal_name_enc, sin bytes
    audit_trail: auditTrail,
  }

  return NextResponse.json(record, {
    headers: {
      'Content-Disposition': `attachment; filename="authority-export-${id}.json"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
