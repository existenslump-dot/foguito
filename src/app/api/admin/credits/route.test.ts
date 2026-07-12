// @vitest-environment node
/**
 * Contract tests del top-up admin/stub de foguitos (PR-6).
 *
 *   gate admin propagado (no-admin → 403) · 400 userId no-UUID
 *   400 amount no-entero/no-positivo · ok/already_applied → 200 + audit
 *   invalid → 400 · error de RPC → 500 (fail-closed)
 *
 * El monto lo fija el admin y está detrás de requireAdmin — único endpoint donde
 * el monto viene del request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const USER = '11111111-1111-1111-1111-111111111111'

let gate: { ok: true; userId: string } | { ok: false; response: NextResponse } = {
  ok: true,
  userId: 'admin-1',
}
vi.mock('@/lib/clients/require-admin', () => ({
  requireAdmin: (..._a: unknown[]) => Promise.resolve(gate),
}))

let rpcResult: { data: unknown; error: unknown } = { data: 'ok', error: null }
const rpcSpy = vi.fn((..._a: unknown[]) => Promise.resolve(rpcResult))
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ rpc: rpcSpy }),
}))

const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...a) }))

import { POST } from './route'

function makeReq(body: unknown) {
  return new Request('https://example.com/api/admin/credits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  gate = { ok: true, userId: 'admin-1' }
  rpcResult = { data: 'ok', error: null }
})

describe('POST /api/admin/credits', () => {
  it('propaga el gate admin (no-admin → 403, nunca toca la RPC)', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    const res = await POST(makeReq({ userId: USER, amount: 100 }))
    expect(res.status).toBe(403)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('401 cuando requireAdmin no autentica', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
    const res = await POST(makeReq({ userId: USER, amount: 100 }))
    expect(res.status).toBe(401)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('400 con userId no-UUID', async () => {
    const res = await POST(makeReq({ userId: 'nope', amount: 100 }))
    expect(res.status).toBe(400)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('400 con amount no entero positivo', async () => {
    for (const amount of [0, -5, 3.5, 'x']) {
      const res = await POST(makeReq({ userId: USER, amount }))
      expect(res.status).toBe(400)
    }
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('ok → 200 { status:ok } + audita el crédito, con default reason', async () => {
    rpcResult = { data: 'ok', error: null }
    const res = await POST(makeReq({ userId: USER, amount: 500 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })

    expect(rpcSpy).toHaveBeenCalledWith('credit_foguitos', {
      p_user: USER,
      p_amount: 500,
      p_reason: 'admin_topup',
      p_idempotency_key: null,
    })

    expect(auditSpy).toHaveBeenCalledTimes(1)
    const arg = auditSpy.mock.calls[0][0] as Record<string, unknown>
    expect(arg.eventType).toBe('foguitos_credited')
    expect(arg.actorRole).toBe('admin')
    expect(arg.actorUserId).toBe('admin-1')
    expect(arg.subjectId).toBe(USER)
  })

  it('pasa reason + idempotencyKey cuando vienen en el body', async () => {
    await POST(makeReq({ userId: USER, amount: 200, reason: 'promo', idempotencyKey: 'k-1' }))
    expect(rpcSpy).toHaveBeenCalledWith('credit_foguitos', {
      p_user: USER,
      p_amount: 200,
      p_reason: 'promo',
      // La key del admin se namespacea con `topup:` (no colisiona con `ppv:*`).
      p_idempotency_key: 'topup:k-1',
    })
  })

  it('already_applied → 200 (idempotente) + audit', async () => {
    rpcResult = { data: 'already_applied', error: null }
    const res = await POST(makeReq({ userId: USER, amount: 500, idempotencyKey: 'k-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'already_applied' })
    expect(auditSpy).toHaveBeenCalledTimes(1)
  })

  it('invalid → 400', async () => {
    rpcResult = { data: 'invalid', error: null }
    const res = await POST(makeReq({ userId: USER, amount: 500 }))
    expect(res.status).toBe(400)
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('error de RPC → 500 (fail-closed, sin filtrar el error crudo)', async () => {
    rpcResult = { data: null, error: { message: 'secret db detail' } }
    const res = await POST(makeReq({ userId: USER, amount: 500 }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('error')
    expect(JSON.stringify(body)).not.toContain('secret db detail')
    expect(auditSpy).not.toHaveBeenCalled()
  })
})
