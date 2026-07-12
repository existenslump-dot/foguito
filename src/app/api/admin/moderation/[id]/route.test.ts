// @vitest-environment node
/**
 * Contract tests de takedown/dismiss (PR-9).
 *
 *   no-admin → 403 (nunca actúa) · gate fresh-TOTP propagado
 *   takedown → content.status='removed' + resuelve la queja + audita
 *   dismiss  → resuelve + audita (sin tocar content)
 *   ya-resuelta → already_resolved sin re-actuar · 400 action inválida · 404
 *   csam_suspected → audit metadata escalate_csam:true
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
let complaintRow: unknown = {
  id: COMPLAINT_ID, content_id: CONTENT_ID, category: 'illegal', status: 'open',
}
let complaintError: { message: string } | null = null

function makeBuilder(table: string) {
  let op = 'select'
  let payload: unknown = null
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    update: vi.fn((p: unknown) => { op = 'update'; payload = p; return builder }),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => {
      calls.push({ table, op, payload })
      return Promise.resolve({ data: complaintRow, error: complaintError })
    }),
    then: (resolve: (v: unknown) => unknown) => {
      calls.push({ table, op, payload })
      return resolve({ data: null, error: null })
    },
  }
  return builder
}
const admin = { from: vi.fn((t: string) => makeBuilder(t)) }
vi.mock('@/lib/clients/supabase-admin', () => ({ getSupabaseAdmin: () => admin }))

import { POST } from './route'

function makeReq(body: unknown) {
  return new Request(`https://example.com/api/admin/moderation/${COMPLAINT_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}
const ctx = (id = COMPLAINT_ID) => ({ params: Promise.resolve({ id }) })
const updateOn = (table: string) => calls.find((c) => c.table === table && c.op === 'update')

beforeEach(() => {
  vi.clearAllMocks()
  gate = { ok: true, userId: 'admin-1' }
  calls = []
  complaintRow = { id: COMPLAINT_ID, content_id: CONTENT_ID, category: 'illegal', status: 'open' }
  complaintError = null
})

describe('POST /api/admin/moderation/[id]', () => {
  it('no-admin → 403, nunca actúa', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    const res = await POST(makeReq({ action: 'takedown' }), ctx())
    expect(res.status).toBe(403)
    expect(updateOn('content')).toBeUndefined()
    expect(updateOn('moderation_events')).toBeUndefined()
  })

  it('exige 2FA enrolada + fresca (requireFreshTotp + requireTotpEnrolled)', async () => {
    await POST(makeReq({ action: 'takedown' }), ctx())
    expect(requireAdminSpy).toHaveBeenCalledTimes(1)
    expect(requireAdminSpy.mock.calls[0][1]).toEqual({ requireFreshTotp: true, requireTotpEnrolled: true })
  })

  it('gate fresh-TOTP stale → 403 code totp_required, no actúa', async () => {
    gate = {
      ok: false,
      response: NextResponse.json({ error: 'Se requiere verificación 2FA reciente', code: 'totp_required' }, { status: 403 }),
    }
    const res = await POST(makeReq({ action: 'takedown' }), ctx())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('totp_required')
    expect(updateOn('content')).toBeUndefined()
  })

  it('400 con action inválida', async () => {
    const res = await POST(makeReq({ action: 'nuke' }), ctx())
    expect(res.status).toBe(400)
    expect(updateOn('content')).toBeUndefined()
  })

  it('404 cuando la queja no existe', async () => {
    complaintRow = null
    const res = await POST(makeReq({ action: 'dismiss' }), ctx())
    expect(res.status).toBe(404)
  })

  it('takedown: content.status=removed + resuelve la queja + audita', async () => {
    const res = await POST(makeReq({ action: 'takedown' }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'actioned', resolution: 'takedown' })

    // content → removed
    const cUpd = updateOn('content')!.payload as Record<string, unknown>
    expect(cUpd).toEqual({ status: 'removed' })

    // queja → actioned/takedown + resolved_by/at
    const qUpd = updateOn('moderation_events')!.payload as Record<string, unknown>
    expect(qUpd.status).toBe('actioned')
    expect(qUpd.resolution).toBe('takedown')
    expect(qUpd.resolved_by).toBe('admin-1')
    expect(typeof qUpd.resolved_at).toBe('string')

    const a = auditSpy.mock.calls[0][0] as Record<string, unknown>
    expect(a.eventType).toBe('takedown_executed')
    expect(a.subjectId).toBe(CONTENT_ID)
    expect((a.metadata as Record<string, unknown>).complaint_id).toBe(COMPLAINT_ID)
  })

  it('takedown sin content_id (borrado): resuelve la queja igual, sin update de content', async () => {
    complaintRow = { id: COMPLAINT_ID, content_id: null, category: 'dmca', status: 'open' }
    const res = await POST(makeReq({ action: 'takedown' }), ctx())
    expect(res.status).toBe(200)
    expect(updateOn('content')).toBeUndefined()
    expect(updateOn('moderation_events')).toBeDefined()
  })

  it('dismiss: resuelve + audita, sin tocar content', async () => {
    const res = await POST(makeReq({ action: 'dismiss' }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'dismissed', resolution: 'dismissed' })
    expect(updateOn('content')).toBeUndefined()
    const qUpd = updateOn('moderation_events')!.payload as Record<string, unknown>
    expect(qUpd.status).toBe('dismissed')
    expect(qUpd.resolution).toBe('dismissed')
    const a = auditSpy.mock.calls[0][0] as Record<string, unknown>
    expect(a.eventType).toBe('complaint_dismissed')
  })

  it('ya-resuelta → already_resolved sin re-actuar', async () => {
    complaintRow = { id: COMPLAINT_ID, content_id: CONTENT_ID, category: 'illegal', status: 'actioned' }
    const res = await POST(makeReq({ action: 'takedown' }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'already_resolved' })
    expect(updateOn('content')).toBeUndefined()
    expect(updateOn('moderation_events')).toBeUndefined()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('csam_suspected takedown → audit metadata escalate_csam:true', async () => {
    complaintRow = { id: COMPLAINT_ID, content_id: CONTENT_ID, category: 'csam_suspected', status: 'open' }
    await POST(makeReq({ action: 'takedown' }), ctx())
    const a = auditSpy.mock.calls[0][0] as Record<string, unknown>
    expect((a.metadata as Record<string, unknown>).escalate_csam).toBe(true)
    // El contenido se baja igual.
    expect((updateOn('content')!.payload as Record<string, unknown>).status).toBe('removed')
  })
})
