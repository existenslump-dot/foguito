// @vitest-environment node
/**
 * Contract tests de /api/payouts/request (PR-8).
 *
 *   404 flag off · 401 sin sesión · 400 monto inválido · cada estado de la RPC →
 *   HTTP (ok→200+audit, not_eligible→403, insufficient_earnings→402,
 *   already_pending→409, amount_too_small/invalid→400) · el creatorId sale de la
 *   SESIÓN, no del body (un creatorId inyectado se ignora).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'

const CREATOR = '11111111-1111-1111-1111-111111111111'
const EVIL = '99999999-9999-9999-9999-999999999999'

let gate: { ok: true; userId: string } | { ok: false; response: NextResponse } = {
  ok: true,
  userId: CREATOR,
}
vi.mock('@/lib/clients/require-user', () => ({
  requireUser: (..._a: unknown[]) => Promise.resolve(gate),
}))

let rpcResult: { data: unknown; error: unknown } = { data: 'ok', error: null }
const rpcSpy = vi.fn((..._a: unknown[]) => Promise.resolve(rpcResult))
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ rpc: rpcSpy }),
}))

const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...a) }))

let rlResult: { success: boolean; retryAfter: number } = { success: true, retryAfter: 0 }
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: (..._a: unknown[]) => Promise.resolve(rlResult),
}))

import { POST } from './route'

function makeReq(body: unknown) {
  return new Request('https://example.com/api/payouts/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PAYOUT_ENABLED', 'true')
  gate = { ok: true, userId: CREATOR }
  rpcResult = { data: 'ok', error: null }
  rlResult = { success: true, retryAfter: 0 }
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/payouts/request', () => {
  it('404 cuando el flag está off (riel inerte)', async () => {
    vi.stubEnv('PAYOUT_ENABLED', '')
    const res = await POST(makeReq({ amountFoguitos: 100 }))
    expect(res.status).toBe(404)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('401 cuando no hay sesión', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
    const res = await POST(makeReq({ amountFoguitos: 100 }))
    expect(res.status).toBe(401)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('429 cuando el rate-limit se excede', async () => {
    rlResult = { success: false, retryAfter: 30 }
    const res = await POST(makeReq({ amountFoguitos: 100 }))
    expect(res.status).toBe(429)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('400 con monto no entero positivo', async () => {
    for (const amountFoguitos of [0, -5, 3.5, 'x', null]) {
      const res = await POST(makeReq({ amountFoguitos }))
      expect(res.status).toBe(400)
    }
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('ok → 200 { status:requested } + audit + rpc con p_creator=SESIÓN', async () => {
    const res = await POST(makeReq({ amountFoguitos: 500 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'requested' })
    expect(rpcSpy).toHaveBeenCalledWith('request_payout', {
      p_creator: CREATOR,
      p_amount_foguitos: 500,
    })
    expect(auditSpy).toHaveBeenCalledTimes(1)
    expect((auditSpy.mock.calls[0][0] as Record<string, unknown>).eventType).toBe('payout_requested')
  })

  it('el creatorId sale de la SESIÓN, nunca del body (creatorId inyectado se ignora)', async () => {
    await POST(makeReq({ amountFoguitos: 500, creatorId: EVIL, p_creator: EVIL }))
    expect(rpcSpy).toHaveBeenCalledWith('request_payout', {
      p_creator: CREATOR,
      p_amount_foguitos: 500,
    })
  })

  it('not_eligible → 403', async () => {
    rpcResult = { data: 'not_eligible', error: null }
    const res = await POST(makeReq({ amountFoguitos: 500 }))
    expect(res.status).toBe(403)
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('insufficient_earnings → 402', async () => {
    rpcResult = { data: 'insufficient_earnings', error: null }
    const res = await POST(makeReq({ amountFoguitos: 500 }))
    expect(res.status).toBe(402)
  })

  it('already_pending → 409', async () => {
    rpcResult = { data: 'already_pending', error: null }
    const res = await POST(makeReq({ amountFoguitos: 500 }))
    expect(res.status).toBe(409)
  })

  it('amount_too_small → 400', async () => {
    rpcResult = { data: 'amount_too_small', error: null }
    const res = await POST(makeReq({ amountFoguitos: 1 }))
    expect(res.status).toBe(400)
  })

  it('invalid → 400', async () => {
    rpcResult = { data: 'invalid', error: null }
    const res = await POST(makeReq({ amountFoguitos: 500 }))
    expect(res.status).toBe(400)
  })

  it('error de la RPC → 500 (fail-closed, sin filtrar el error crudo)', async () => {
    rpcResult = { data: null, error: { message: 'secret db detail' } }
    const res = await POST(makeReq({ amountFoguitos: 500 }))
    expect(res.status).toBe(500)
    const bodyJson = await res.json()
    expect(JSON.stringify(bodyJson)).not.toContain('secret db detail')
    expect(auditSpy).not.toHaveBeenCalled()
  })
})
