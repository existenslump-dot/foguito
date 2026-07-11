import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireUser } from '@/lib/clients/require-user'
import { createPerformer } from '@/lib/performers'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * POST /api/performers — creator-facing 2257 collaborator registration.
 *
 * A creator registers a performer who appears in her content. (Her OWN 2257
 * record is auto-created + certified by the Didit webhook once she's verified
 * 18+; this endpoint is for COLLABORATORS she films with.)
 *
 * The performer's ID document is uploaded to the private `identity-documents`
 * bucket UNDER THE CREATOR's own uid prefix — `{uid}/performers/<uuid>/` — so it
 * stays inside her per-user RLS scope. The admin reads it later via service-role
 * (getPerformerForReview). This sub-prefix is EXCLUDED from the identity-
 * retention purge — 2257 docs have a long legal retention window (18 U.S.C.
 * 2257); see src/lib/identity-retention.ts.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ INVARIANTE #1: this creator-facing path NEVER sets is_complete/dob_verified.│
 * │ The record lands INCOMPLETE; only the admin (POST .../complete) — or the    │
 * │ Didit webhook for the creator's OWN self record — certifies it. Until then  │
 * │ content_publish_guard blocks publishing any content linked to it.           │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

// Mirror the identity-upload limits so a creator can't sneak an oversized file
// through the direct-to-Storage path.
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_LEGAL_NAME = 200
const MAX_CUSTODIAN = 200

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requireUser(req)
    if (!gate.ok) return gate.response

    const form = await req.formData()

    const legalName = String(form.get('legal_name') ?? '').trim()
    if (!legalName || legalName.length > MAX_LEGAL_NAME) {
      return err('legal_name requerido (máx 200 caracteres)')
    }

    const custodianRaw = form.get('custodian')
    const custodian =
      custodianRaw != null && String(custodianRaw).trim()
        ? String(custodianRaw).trim().slice(0, MAX_CUSTODIAN)
        : null

    const idDoc = form.get('id_doc') as File | null
    if (!idDoc) return err('Falta el documento de identidad (id_doc)')
    if (!IMAGE_MIMES.has(idDoc.type)) {
      return err(`id_doc: tipo no permitido (${idDoc.type}). Usa JPG/PNG/WebP.`)
    }
    if (idDoc.size > MAX_IMAGE_SIZE_BYTES) {
      return err(`id_doc: excede ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB`)
    }

    const admin = getSupabaseAdmin()

    // ext desde el MIME YA VALIDADO (no el filename del cliente): el filename
    // podría traer basura/barras; idDoc.type ya pasó IMAGE_MIMES (jpg/png/webp).
    const ext = idDoc.type === 'image/png' ? 'png' : idDoc.type === 'image/webp' ? 'webp' : 'jpg'
    // Bound to the SESSION user (gate.userId), never a body field. Kept under the
    // creator's own uid so her RLS scope covers it; the `performers/` sub-prefix
    // is retention-exempt (2257 legal retention).
    const idDocPath = `${gate.userId}/performers/${randomUUID()}/id_doc.${ext}`

    const up = await admin.storage
      .from('identity-documents')
      .upload(idDocPath, idDoc, { upsert: true, contentType: idDoc.type })
    if (up.error) return err(`Storage upload failed: ${up.error.message}`, 500)

    // added_by = gate.userId (session), NOT trusted from the request body.
    // createPerformer OMITS is_complete/dob_verified — INVARIANTE #1.
    const created = await createPerformer(admin, {
      addedBy: gate.userId,
      legalName,
      idDocPath,
      custodian,
    })
    if (!created.ok) return err(created.error, 500)

    void recordAudit({
      eventType: 'performer_registered',
      actorRole: 'user',
      actorUserId: gate.userId,
      subjectType: 'performer',
      subjectId: created.id,
      req,
      metadata: { custodian, is_self: false },
    })

    return NextResponse.json({ id: created.id })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error desconocido' },
      { status: 500 },
    )
  }
}
