// @vitest-environment node
/**
 * Contract tests for the 2257 certification route — the admin path that flips
 * is_complete/dob_verified true (one of the only two certification paths).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

let gate: { ok: true; userId: string } | { ok: false; response: Response } = { ok: true, userId: 'admin-1' }
const requireAdminSpy = vi.fn(() => Promise.resolve(gate))
vi.mock('@/lib/clients/require-admin', () => ({ requireAdmin: (...a: unknown[]) => requireAdminSpy(...(a as [])) }))

let completeResult: { ok: boolean; error?: string } = { ok: true }
const completeSpy = vi.fn(() => Promise.resolve(completeResult))
vi.mock('@/lib/performers', () => ({ completePerformer: (...a: unknown[]) => completeSpy(...(a as [])) }))

const auditSpy = vi.fn(() => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...(a as [])) }))
vi.mock('@/lib/clients/supabase-admin', () => ({ getSupabaseAdmin: () => ({}) }))

import { NextRequest } from 'next/server'
import { POST } from './route'

const UID = '11111111-1111-1111-1111-111111111111'

function req() {
  return new NextRequest('https://example.com/api/admin/performers/x/complete', { method: 'POST' })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  gate = { ok: true, userId: 'admin-1' }
  completeResult = { ok: true }
})

describe('POST /api/admin/performers/[id]/complete', () => {
  it('requires a FRESH admin TOTP (same bar as the age attestation)', async () => {
    await POST(req(), ctx(UID))
    expect(requireAdminSpy).toHaveBeenCalledWith(expect.anything(), { requireFreshTotp: true })
  })

  it('propagates the admin gate (403)', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    const res = await POST(req(), ctx(UID))
    expect(res.status).toBe(403)
    expect(completeSpy).not.toHaveBeenCalled()
  })

  it('400 when the id is not a UUID', async () => {
    const res = await POST(req(), ctx('nope'))
    expect(res.status).toBe(400)
    expect(completeSpy).not.toHaveBeenCalled()
  })

  it('certifies the record and writes an audit entry', async () => {
    const res = await POST(req(), ctx(UID))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(completeSpy).toHaveBeenCalledWith({}, UID)
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'performer_2257_completed', subjectId: UID, actorRole: 'admin' }),
    )
  })

  it('404 when the record does not exist', async () => {
    completeResult = { ok: false, error: 'performer not found' }
    const res = await POST(req(), ctx(UID))
    expect(res.status).toBe(404)
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('500 on a DB error', async () => {
    completeResult = { ok: false, error: 'db down' }
    const res = await POST(req(), ctx(UID))
    expect(res.status).toBe(500)
  })
})
