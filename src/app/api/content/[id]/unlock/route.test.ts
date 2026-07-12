// @vitest-environment node
/**
 * Contract tests del endpoint de desbloqueo PPV (PR-6).
 *
 * Orden fail-closed + mapeo de estado→HTTP:
 *   401  → sin sesión (requireUser)
 *   403  → requireUser deniega (same-origin / forbidden)
 *   400  → id no-UUID
 *   429  → rate-limit
 *   ok               → 200 { status:'unlocked' } + audit
 *   already_unlocked → 200 (sin audit)
 *   insufficient_funds → 402
 *   not_purchasable / no_price → 409
 *   not_found → 404 · invalid → 400
 *   error de RPC → 500 (fail-closed, sin filtrar el error crudo)
 *
 * INVARIANTE: p_fan == el userId de la SESIÓN, nunca del path/body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const VALID_ID = '11111111-1111-1111-1111-111111111111'

// ── requireUser ─────────────────────────────────────────────────────
let gate: { ok: true; userId: string } | { ok: false; response: NextResponse } = {
  ok: true,
  userId: 'fan-1',
}
vi.mock('@/lib/clients/require-user', () => ({
  requireUser: (..._a: unknown[]) => Promise.resolve(gate),
}))

// ── rate limit ──────────────────────────────────────────────────────
let rlResult: { success: boolean; retryAfter: number } = { success: true, retryAfter: 0 }
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: (..._a: unknown[]) => Promise.resolve(rlResult),
}))

// ── service-role RPC ────────────────────────────────────────────────
let rpcResult: { data: unknown; error: unknown } = { data: 'ok', error: null }
const rpcSpy = vi.fn((..._a: unknown[]) => Promise.resolve(rpcResult))
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ rpc: rpcSpy }),
}))

// ── audit ───────────────────────────────────────────────────────────
const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...a) }))

import { POST } from './route'

function makeReq() {
  return new Request(`https://example.com/api/content/${VALID_ID}/unlock`, {
    method: 'POST',
  }) as never
}
function ctx(id = VALID_ID) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  gate = { ok: true, userId: 'fan-1' }
  rlResult = { success: true, retryAfter: 0 }
  rpcResult = { data: 'ok', error: null }
})

describe('POST /api/content/[id]/unlock', () => {
  it('401 cuando no hay sesión (nunca toca la RPC)', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
    const res = await POST(makeReq(), ctx())
    expect(res.status).toBe(401)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('403 cuando requireUser deniega (same-origin/forbidden)', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Invalid origin' }, { status: 403 }) }
    const res = await POST(makeReq(), ctx())
    expect(res.status).toBe(403)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('400 con un id que no es UUID (nunca toca la RPC)', async () => {
    const res = await POST(makeReq(), ctx('not-a-uuid'))
    expect(res.status).toBe(400)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('429 en rate-limit con Retry-After', async () => {
    rlResult = { success: false, retryAfter: 12 }
    const res = await POST(makeReq(), ctx())
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('12')
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('ok → 200 { status:unlocked } + audita el desbloqueo', async () => {
    rpcResult = { data: 'ok', error: null }
    const res = await POST(makeReq(), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'unlocked' })

    // p_fan == la sesión, p_content == el id del path
    expect(rpcSpy).toHaveBeenCalledWith('unlock_ppv_content', {
      p_fan: 'fan-1',
      p_content: VALID_ID,
    })

    expect(auditSpy).toHaveBeenCalledTimes(1)
    const arg = auditSpy.mock.calls[0][0] as Record<string, unknown>
    expect(arg.eventType).toBe('content_unlocked')
    expect(arg.actorUserId).toBe('fan-1')
    expect(arg.subjectId).toBe(VALID_ID)
  })

  it('already_unlocked → 200 sin re-cobro ni audit', async () => {
    rpcResult = { data: 'already_unlocked', error: null }
    const res = await POST(makeReq(), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'already_unlocked' })
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('insufficient_funds → 402', async () => {
    rpcResult = { data: 'insufficient_funds', error: null }
    const res = await POST(makeReq(), ctx())
    expect(res.status).toBe(402)
    expect((await res.json()).error).toBe('insufficient_funds')
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('not_purchasable → 409', async () => {
    rpcResult = { data: 'not_purchasable', error: null }
    const res = await POST(makeReq(), ctx())
    expect(res.status).toBe(409)
  })

  it('no_price → 409', async () => {
    rpcResult = { data: 'no_price', error: null }
    const res = await POST(makeReq(), ctx())
    expect(res.status).toBe(409)
  })

  it('not_found → 404', async () => {
    rpcResult = { data: 'not_found', error: null }
    const res = await POST(makeReq(), ctx())
    expect(res.status).toBe(404)
  })

  it('invalid → 400', async () => {
    rpcResult = { data: 'invalid', error: null }
    const res = await POST(makeReq(), ctx())
    expect(res.status).toBe(400)
  })

  it('error de RPC → 500 (fail-closed, sin filtrar el error crudo)', async () => {
    rpcResult = { data: null, error: { message: 'db exploded: secret detail' } }
    const res = await POST(makeReq(), ctx())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('error')
    expect(JSON.stringify(body)).not.toContain('secret detail')
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('estado desconocido de la RPC → 500 (fail-closed)', async () => {
    rpcResult = { data: 'weird_new_status', error: null }
    const res = await POST(makeReq(), ctx())
    expect(res.status).toBe(500)
    expect(auditSpy).not.toHaveBeenCalled()
  })
})
