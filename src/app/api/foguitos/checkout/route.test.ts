// @vitest-environment node
/**
 * Contract tests del checkout de money-in (PR-7).
 *
 * Orden fail-closed:
 *   404  → feature flag off (riel inerte)
 *   401/403 → requireUser (sesión / same-origin)
 *   400  → packId fuera del catálogo
 *   429  → rate-limit
 *   200  → orden 'pending' insertada ANTES del provider · gateway_tx_id updateado
 *   502  → el provider tira ⇒ la orden se marca 'failed'
 *
 * INVARIANTES:
 *   - el user_id de la orden == la SESIÓN, jamás un user_id del body.
 *   - el monto/precio de la orden salen del CATÁLOGO, jamás del cliente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// ── feature flag ────────────────────────────────────────────────────
let enabled = true
vi.mock('@/lib/foguitos/config', () => ({
  isFoguitoPaymentsEnabled: () => enabled,
}))

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

// ── service-role: from().insert() + from().update().eq()... ─────────
let insertError: unknown = null
let updateError: unknown = null
const insertSpy = vi.fn((..._a: unknown[]) => Promise.resolve({ error: insertError }))
const updateSpy = vi.fn((..._a: unknown[]) => {
  const chain: Record<string, unknown> = {
    eq: vi.fn((..._e: unknown[]) => chain),
    then: (resolve: (v: { error: unknown }) => void) => resolve({ error: updateError }),
  }
  return chain
})
const fromSpy = vi.fn((..._a: unknown[]) => ({ insert: insertSpy, update: updateSpy }))
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: fromSpy }),
}))

// ── provider ────────────────────────────────────────────────────────
let providerThrows = false
const providerResult = { gatewayTxId: 'STUB-ord', payAddress: 'STUB', payUrl: null }
const createCheckoutSpy = vi.fn((..._a: unknown[]) =>
  providerThrows ? Promise.reject(new Error('provider boom')) : Promise.resolve(providerResult),
)
vi.mock('@/lib/foguitos/provider', () => ({
  getFoguitoPaymentProvider: () => ({ createCheckout: createCheckoutSpy }),
}))

// ── audit ───────────────────────────────────────────────────────────
const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...a) }))

import { POST } from './route'

function makeReq(body: unknown) {
  return new Request('https://example.com/api/foguitos/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  enabled = true
  gate = { ok: true, userId: 'fan-1' }
  rlResult = { success: true, retryAfter: 0 }
  insertError = null
  updateError = null
  providerThrows = false
})

describe('POST /api/foguitos/checkout', () => {
  it('404 cuando el feature flag está off (nunca inserta ni llama al provider)', async () => {
    enabled = false
    const res = await POST(makeReq({ packId: 'pack_500' }))
    expect(res.status).toBe(404)
    expect(insertSpy).not.toHaveBeenCalled()
    expect(createCheckoutSpy).not.toHaveBeenCalled()
  })

  it('401 cuando no hay sesión (nunca inserta)', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
    const res = await POST(makeReq({ packId: 'pack_500' }))
    expect(res.status).toBe(401)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('403 cuando requireUser deniega (same-origin)', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Invalid origin' }, { status: 403 }) }
    const res = await POST(makeReq({ packId: 'pack_500' }))
    expect(res.status).toBe(403)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('400 con un packId fuera del catálogo (nunca inserta)', async () => {
    const res = await POST(makeReq({ packId: 'pack_nope' }))
    expect(res.status).toBe(400)
    expect(insertSpy).not.toHaveBeenCalled()
    expect(createCheckoutSpy).not.toHaveBeenCalled()
  })

  it('429 en rate-limit con Retry-After (nunca inserta)', async () => {
    rlResult = { success: false, retryAfter: 30 }
    const res = await POST(makeReq({ packId: 'pack_500' }))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('30')
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('200: inserta la orden ANTES del provider, con monto/precio del catálogo', async () => {
    const res = await POST(makeReq({ packId: 'pack_500' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orderRef).toMatch(/^ord_/)
    expect(body.payAddress).toBe('STUB')

    // La orden se insertó ANTES de llamar al provider (fail-closed).
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(createCheckoutSpy).toHaveBeenCalledTimes(1)
    expect(insertSpy.mock.invocationCallOrder[0]).toBeLessThan(
      createCheckoutSpy.mock.invocationCallOrder[0],
    )

    // Monto/precio del CATÁLOGO (pack_500 = 500 foguitos / US$5), user de la sesión.
    const insertArg = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(insertArg.amount_foguitos).toBe(500)
    expect(insertArg.price_amount).toBe(5)
    expect(insertArg.price_currency).toBe('USD')
    expect(insertArg.status).toBe('pending')
    expect(insertArg.user_id).toBe('fan-1')

    // gateway_tx_id updateado tras el alta.
    expect(updateSpy).toHaveBeenCalledWith({ gateway_tx_id: 'STUB-ord' })
    expect(auditSpy).toHaveBeenCalledTimes(1)
  })

  it('ignora un user_id inyectado en el body — usa el de la SESIÓN', async () => {
    await POST(makeReq({ packId: 'pack_500', userId: 'attacker', amount_foguitos: 999999 }))
    const insertArg = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(insertArg.user_id).toBe('fan-1')
    // El monto NO viene del body — sale del catálogo.
    expect(insertArg.amount_foguitos).toBe(500)
  })

  it('500 cuando el insert de la orden falla (nunca llama al provider)', async () => {
    insertError = { message: 'db down' }
    const res = await POST(makeReq({ packId: 'pack_500' }))
    expect(res.status).toBe(500)
    expect(createCheckoutSpy).not.toHaveBeenCalled()
  })

  it('502 cuando el provider tira ⇒ la orden se marca failed', async () => {
    providerThrows = true
    const res = await POST(makeReq({ packId: 'pack_500' }))
    expect(res.status).toBe(502)
    // La orden ya insertada se marca 'failed' (sólo mientras 'pending').
    const failedUpdate = updateSpy.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>)?.status === 'failed',
    )
    expect(failedUpdate).toBeTruthy()
    expect(auditSpy).not.toHaveBeenCalled()
  })
})
