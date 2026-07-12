// @vitest-environment node
/**
 * Contract tests del endpoint de suscripción (PR-6).
 *
 *   401 sin sesión · 403 requireUser deniega · 400 creatorId no-UUID
 *   400 auto-suscripción (creatorId === fanId) · 429 rate-limit
 *   ok → 200 { status:subscribed } + audit · already_active → 200
 *   insufficient_funds → 402 · subs_not_offered → 409 · invalid → 400
 *   error de RPC → 500 (fail-closed)
 *
 * INVARIANTE: p_fan == el userId de la SESIÓN, nunca del body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const FAN = '11111111-1111-1111-1111-111111111111'
const CREATOR = '22222222-2222-2222-2222-222222222222'

let gate: { ok: true; userId: string } | { ok: false; response: NextResponse } = {
  ok: true,
  userId: FAN,
}
vi.mock('@/lib/clients/require-user', () => ({
  requireUser: (..._a: unknown[]) => Promise.resolve(gate),
}))

let rlResult: { success: boolean; retryAfter: number } = { success: true, retryAfter: 0 }
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: (..._a: unknown[]) => Promise.resolve(rlResult),
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
  return new Request('https://example.com/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  gate = { ok: true, userId: FAN }
  rlResult = { success: true, retryAfter: 0 }
  rpcResult = { data: 'ok', error: null }
})

describe('POST /api/subscribe', () => {
  it('401 cuando no hay sesión (nunca toca la RPC)', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
    const res = await POST(makeReq({ creatorId: CREATOR }))
    expect(res.status).toBe(401)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('403 cuando requireUser deniega', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Invalid origin' }, { status: 403 }) }
    const res = await POST(makeReq({ creatorId: CREATOR }))
    expect(res.status).toBe(403)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('400 con creatorId no-UUID', async () => {
    const res = await POST(makeReq({ creatorId: 'nope' }))
    expect(res.status).toBe(400)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('400 al intentar suscribirse a sí misma (creatorId === fanId)', async () => {
    const res = await POST(makeReq({ creatorId: FAN }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('cannot_subscribe_self')
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('429 en rate-limit con Retry-After', async () => {
    rlResult = { success: false, retryAfter: 7 }
    const res = await POST(makeReq({ creatorId: CREATOR }))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('7')
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('ok → 200 { status:subscribed } + audita, con p_fan de la SESIÓN', async () => {
    rpcResult = { data: 'ok', error: null }
    const res = await POST(makeReq({ creatorId: CREATOR }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'subscribed' })

    expect(rpcSpy).toHaveBeenCalledWith('subscribe_creator', {
      p_fan: FAN,
      p_creator: CREATOR,
    })

    expect(auditSpy).toHaveBeenCalledTimes(1)
    const arg = auditSpy.mock.calls[0][0] as Record<string, unknown>
    expect(arg.eventType).toBe('subscription_created')
    expect(arg.actorUserId).toBe(FAN)
    expect(arg.subjectId).toBe(CREATOR)
  })

  it('ignora un fanId inyectado en el body — usa el de la sesión', async () => {
    rpcResult = { data: 'ok', error: null }
    await POST(makeReq({ creatorId: CREATOR, fanId: 'ATTACKER', p_fan: 'ATTACKER' }))
    expect(rpcSpy).toHaveBeenCalledWith('subscribe_creator', {
      p_fan: FAN,
      p_creator: CREATOR,
    })
  })

  it('already_active → 200 sin audit', async () => {
    rpcResult = { data: 'already_active', error: null }
    const res = await POST(makeReq({ creatorId: CREATOR }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'already_active' })
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('insufficient_funds → 402', async () => {
    rpcResult = { data: 'insufficient_funds', error: null }
    const res = await POST(makeReq({ creatorId: CREATOR }))
    expect(res.status).toBe(402)
  })

  it('subs_not_offered → 409', async () => {
    rpcResult = { data: 'subs_not_offered', error: null }
    const res = await POST(makeReq({ creatorId: CREATOR }))
    expect(res.status).toBe(409)
  })

  it('invalid → 400', async () => {
    rpcResult = { data: 'invalid', error: null }
    const res = await POST(makeReq({ creatorId: CREATOR }))
    expect(res.status).toBe(400)
  })

  it('error de RPC → 500 (fail-closed, sin filtrar el error crudo)', async () => {
    rpcResult = { data: null, error: { message: 'secret db detail' } }
    const res = await POST(makeReq({ creatorId: CREATOR }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('error')
    expect(JSON.stringify(body)).not.toContain('secret db detail')
    expect(auditSpy).not.toHaveBeenCalled()
  })
})
