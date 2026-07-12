// @vitest-environment node
/**
 * Contract tests de /api/admin/consumers/[id]/screen (PR-10, tercera superficie AML).
 *
 *   gate admin propagado (no-admin → 403/401) · TOTP fresca + enrolada exigidas ·
 *   id no-UUID → 400 · perfil inexistente → 404 · screening OK → screenSubject
 *   (consumer) + audit consumer_screened + { sanctions_status, ref } · throw del
 *   provider → 502 (fail-closed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const CONSUMER = '22222222-2222-2222-2222-222222222222'

// ── admin gate ───────────────────────────────────────────────────────
let gate: { ok: true; userId: string } | { ok: false; response: NextResponse } = {
  ok: true,
  userId: 'admin-1',
}
const requireAdminSpy = vi.fn((..._a: unknown[]) => Promise.resolve(gate))
vi.mock('@/lib/clients/require-admin', () => ({
  requireAdmin: (...a: unknown[]) => requireAdminSpy(...a),
}))

// ── service-role: from('profiles').select().eq().maybeSingle() ───────
let profileRow: { id: string } | null = { id: CONSUMER }
const fromSpy = vi.fn((..._a: unknown[]) => {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data: profileRow, error: null })),
  }
  return chain
})
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: fromSpy }),
}))

// ── motor AML ────────────────────────────────────────────────────────
let screenResult: { status: 'clear' | 'review' | 'hit'; ref: string; provider: string } = {
  status: 'clear',
  ref: 'S-CONS',
  provider: 'stub',
}
let screenThrows = false
const screenSpy = vi.fn((..._a: unknown[]) =>
  screenThrows ? Promise.reject(new Error('sanctions boom')) : Promise.resolve(screenResult),
)
vi.mock('@/lib/aml', () => ({ screenSubject: (...a: unknown[]) => screenSpy(...a) }))

const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...a) }))

import { POST } from './route'

function req() {
  return new Request('https://example.com/api/admin/consumers/x/screen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }) as never
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  gate = { ok: true, userId: 'admin-1' }
  profileRow = { id: CONSUMER }
  screenResult = { status: 'clear', ref: 'S-CONS', provider: 'stub' }
  screenThrows = false
})

describe('POST /api/admin/consumers/[id]/screen', () => {
  it('propaga el gate admin (no-admin → 403, nada se llama)', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    const res = await POST(req(), ctx(CONSUMER))
    expect(res.status).toBe(403)
    expect(screenSpy).not.toHaveBeenCalled()
  })

  it('401 cuando requireAdmin no autentica', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
    const res = await POST(req(), ctx(CONSUMER))
    expect(res.status).toBe(401)
  })

  it('exige TOTP enrolada (fail-closed) + fresca', async () => {
    await POST(req(), ctx(CONSUMER))
    expect(requireAdminSpy).toHaveBeenCalledWith(expect.anything(), {
      requireFreshTotp: true,
      requireTotpEnrolled: true,
    })
  })

  it('400 con id no-UUID', async () => {
    const res = await POST(req(), ctx('nope'))
    expect(res.status).toBe(400)
    expect(screenSpy).not.toHaveBeenCalled()
  })

  it('404 si el perfil no existe', async () => {
    profileRow = null
    const res = await POST(req(), ctx(CONSUMER))
    expect(res.status).toBe(404)
    expect(screenSpy).not.toHaveBeenCalled()
  })

  it('screening OK → screenSubject(consumer) + audit consumer_screened + { sanctions_status, ref }', async () => {
    const res = await POST(req(), ctx(CONSUMER))
    expect(res.status).toBe(200)
    expect(screenSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ subjectType: 'consumer', subjectId: CONSUMER }),
    )
    expect(await res.json()).toMatchObject({ sanctions_status: 'clear', ref: 'S-CONS' })
    const evt = auditSpy.mock.calls.map((c) => (c[0] as Record<string, unknown>).eventType)
    expect(evt).toContain('consumer_screened')
  })

  it('un fan "hit" se refleja en la respuesta', async () => {
    screenResult = { status: 'hit', ref: 'S-HIT', provider: 'stub' }
    const res = await POST(req(), ctx(CONSUMER))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sanctions_status: 'hit' })
  })

  it('throw del provider → 502 (fail-closed), no audita compra', async () => {
    screenThrows = true
    const res = await POST(req(), ctx(CONSUMER))
    expect(res.status).toBe(502)
    const evt = auditSpy.mock.calls.map((c) => (c[0] as Record<string, unknown>).eventType)
    expect(evt).not.toContain('consumer_screened')
  })
})
