// @vitest-environment node
/**
 * Contract tests del authority export (PR-9).
 *
 *   no-admin / no-fresh-TOTP → bloqueado (nunca marca ni audita)
 *   export = content ref + complaint + performer REFERENCES + audit slice
 *   INVARIANTE: NUNCA legal_name descifrado, NUNCA bytes/URL firmada de media
 *   marca authority_export_status='generated' + audita · csam flag prominente
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const COMPLAINT_ID = '22222222-2222-2222-2222-222222222222'
const CONTENT_ID = '11111111-1111-1111-1111-111111111111'

// ── requireAdmin (con captura de opciones) ───────────────────────────
let gate: { ok: true; userId: string } | { ok: false; response: NextResponse } = {
  ok: true,
  userId: 'admin-1',
}
const requireAdminSpy = vi.fn((..._a: unknown[]) => Promise.resolve(gate))
vi.mock('@/lib/clients/require-admin', () => ({
  requireAdmin: (...a: unknown[]) => requireAdminSpy(...a),
}))

// ── audit ────────────────────────────────────────────────────────────
const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...a) }))

// ── service-role admin fake ──────────────────────────────────────────
type Call = { table: string; op: string; payload: unknown }
let calls: Call[] = []

let complaint: unknown = {
  id: COMPLAINT_ID, content_id: CONTENT_ID, creator_id: 'u1', category: 'illegal',
  status: 'open', reporter_ip: '2.2.2.2', description: 'ilegal',
}
const contentRef = {
  id: CONTENT_ID, status: 'published', created_at: '2026-07-01T00:00:00Z',
  published_at: '2026-07-02T00:00:00Z', media_ref: 'u1/abc/media.jpg',
  media_type: 'image', visibility: 'tier', csam_status: 'pass',
}
const allComplaints = [complaint]
const links = [{ performer_id: 'perf-1' }]
// performers_2257 REFERENCES — el route NO selecciona legal_name_enc; el fake
// devuelve exactamente lo que el select pide (sin el nombre legal).
const perfs = [
  { id: 'perf-1', id_doc_path: 'u1/perf-1/id_doc.jpg', custodian: 'Custodio SA', added_by: 'u1', is_complete: true, dob_verified: true, created_at: '2026-06-01T00:00:00Z' },
]
const auditTrail = [
  { id: 'a1', event_type: 'content_published', actor_role: 'admin', actor_user_id: 'admin-1', subject_type: 'content', subject_id: CONTENT_ID, ip: '3.3.3.3', metadata: {}, created_at: '2026-07-02T00:00:00Z' },
]

function makeBuilder(table: string) {
  let op = 'select'
  let payload: unknown = null
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    update: vi.fn((p: unknown) => { op = 'update'; payload = p; return builder }),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(() => {
      calls.push({ table, op, payload })
      const data = table === 'content' ? contentRef : complaint
      return Promise.resolve({ data, error: null })
    }),
    then: (resolve: (v: unknown) => unknown) => {
      calls.push({ table, op, payload })
      let data: unknown = null
      if (table === 'moderation_events' && op === 'select') data = allComplaints
      else if (table === 'content_performers') data = links
      else if (table === 'performers_2257') data = perfs
      else if (table === 'audit_log') data = auditTrail
      return resolve({ data, error: null })
    },
  }
  return builder
}
const admin = { from: vi.fn((t: string) => makeBuilder(t)) }
vi.mock('@/lib/clients/supabase-admin', () => ({ getSupabaseAdmin: () => admin }))

import { GET } from './route'

function makeReq() {
  return new Request(`https://example.com/api/admin/moderation/${COMPLAINT_ID}/export`) as never
}
const ctx = (id = COMPLAINT_ID) => ({ params: Promise.resolve({ id }) })
const updateOn = (table: string) => calls.find((c) => c.table === table && c.op === 'update')

beforeEach(() => {
  vi.clearAllMocks()
  gate = { ok: true, userId: 'admin-1' }
  calls = []
  complaint = {
    id: COMPLAINT_ID, content_id: CONTENT_ID, creator_id: 'u1', category: 'illegal',
    status: 'open', reporter_ip: '2.2.2.2', description: 'ilegal',
  }
})

describe('GET /api/admin/moderation/[id]/export', () => {
  it('no-admin → 403, nunca marca ni audita', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    const res = await GET(makeReq(), ctx())
    expect(res.status).toBe(403)
    expect(updateOn('moderation_events')).toBeUndefined()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('exige 2FA enrolada + fresca (requireFreshTotp + requireTotpEnrolled)', async () => {
    await GET(makeReq(), ctx())
    expect(requireAdminSpy.mock.calls[0][1]).toEqual({ requireFreshTotp: true, requireTotpEnrolled: true })
  })

  it('404 cuando la queja no existe', async () => {
    complaint = null
    const res = await GET(makeReq(), ctx())
    expect(res.status).toBe(404)
    expect(updateOn('moderation_events')).toBeUndefined()
  })

  it('arma el registro: content ref + complaint + performer refs + audit slice', async () => {
    const res = await GET(makeReq(), ctx())
    expect(res.status).toBe(200)
    const rec = await res.json()

    expect(rec.references_only).toBe(true)
    expect(rec.complaint.id).toBe(COMPLAINT_ID)
    expect(rec.content).toEqual(contentRef)
    expect(rec.complaints_for_content).toEqual(allComplaints)
    expect(rec.performers_2257_references).toEqual(perfs)
    expect(rec.audit_trail).toEqual(auditTrail)

    // media_ref presente como PATH (referencia), NUNCA firmado/bytes.
    expect(rec.content.media_ref).toBe('u1/abc/media.jpg')

    // Content-Disposition de descarga + no-store.
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('INVARIANTE: sin legal_name descifrado, sin bytes/URL firmada de media', async () => {
    const res = await GET(makeReq(), ctx())
    const raw = JSON.stringify(await res.json())
    // Nada de nombre legal (ni el cifrado ni descifrado).
    expect(raw).not.toContain('legal_name')
    // Nada de URL firmada / token / bucket firmado inline.
    expect(raw).not.toMatch(/signedurl|token=|\.supabase\.co/i)
    // No hay bytes base64 de media embebidos (sólo el PATH).
    expect(raw).not.toContain('data:image')
  })

  it('marca authority_export_status=generated + audita', async () => {
    const res = await GET(makeReq(), ctx())
    expect(res.status).toBe(200)
    const upd = updateOn('moderation_events')!.payload as Record<string, unknown>
    expect(upd).toEqual({ authority_export_status: 'generated' })

    const a = auditSpy.mock.calls[0][0] as Record<string, unknown>
    expect(a.eventType).toBe('authority_export_generated')
    expect(a.subjectId).toBe(CONTENT_ID)
  })

  it('csam_suspected → flag NCMEC prominente y no-null', async () => {
    complaint = {
      id: COMPLAINT_ID, content_id: CONTENT_ID, creator_id: 'u1', category: 'csam_suspected',
      status: 'open', reporter_ip: '2.2.2.2', description: null,
    }
    const res = await GET(makeReq(), ctx())
    const rec = await res.json()
    expect(rec.csam_mandatory_ncmec).toBeTruthy()
    expect(String(rec.csam_mandatory_ncmec)).toMatch(/NCMEC/i)
  })

  it('categoría no-CSAM → csam_mandatory_ncmec null', async () => {
    const res = await GET(makeReq(), ctx())
    const rec = await res.json()
    expect(rec.csam_mandatory_ncmec).toBeNull()
  })
})
