// @vitest-environment node
/**
 * Contract tests del webhook de money-in (PR-7).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ El único factor de confianza es la firma HMAC. Un evento sin firma válida   │
 * │ NO acredita NADA (401). NUNCA se credita en un estado != 'finished', ni con │
 * │ monto que no matchea, ni para una orden desconocida. El crédito lo hace la  │
 * │ RPC `purchase_foguitos` (atómica, idempotente) leyendo el monto de la ORDEN.│
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * La firma se mockea vía un override; con el override en `null` corre la
 * verificación HMAC REAL (test que NO mockea la firma).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import { canonicalNowpaymentsBody } from '@/lib/foguitos/provider/signature'

const SECRET = 'ipn_test_secret'

// ── firma: override booleano; `null` ⇒ corre el HMAC real ───────────
let signatureOverride: boolean | null = true
vi.mock('@/lib/foguitos/provider/signature', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/foguitos/provider/signature')>()
  return {
    ...actual,
    verifyNowpaymentsSignature: (rawBody: string, sig: string | null) =>
      signatureOverride === null ? actual.verifyNowpaymentsSignature(rawBody, sig) : signatureOverride,
  }
})

// ── service-role: from().select().eq().maybeSingle() · from().update().eq()... · rpc ──
let orderRow:
  | { order_ref: string; status: string; provider: string; price_amount: number | string; price_currency: string }
  | null = {
  order_ref: 'ord_abc',
  status: 'pending',
  provider: 'nowpayments',
  price_amount: 5,
  price_currency: 'USD',
}
let rpcResult: { data: unknown; error: unknown } = { data: 'ok', error: null }

const maybeSingleSpy = vi.fn((..._a: unknown[]) => Promise.resolve({ data: orderRow }))
const selectChain: Record<string, unknown> = {
  eq: vi.fn((..._a: unknown[]) => selectChain),
  maybeSingle: maybeSingleSpy,
}
const selectSpy = vi.fn((..._a: unknown[]) => selectChain)
const updateSpy = vi.fn((..._a: unknown[]) => {
  const chain: Record<string, unknown> = {
    eq: vi.fn((..._e: unknown[]) => chain),
    then: (resolve: (v: { error: unknown }) => void) => resolve({ error: null }),
  }
  return chain
})
const rpcSpy = vi.fn((..._a: unknown[]) => Promise.resolve(rpcResult))
const fromSpy = vi.fn((..._a: unknown[]) => ({ select: selectSpy, update: updateSpy }))
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: fromSpy, rpc: rpcSpy }),
}))

// ── audit ───────────────────────────────────────────────────────────
const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...a) }))

import { POST } from './route'

const basePayload = {
  payment_id: 5524759814,
  payment_status: 'finished',
  order_id: 'ord_abc',
  price_amount: 5,
  price_currency: 'usd',
  pay_amount: 4.9,
}

function makeReq(payload: unknown, sig = 'x'.repeat(128)) {
  return new Request('https://example.com/api/webhooks/foguitos/nowpayments', {
    method: 'POST',
    headers: { 'x-nowpayments-sig': sig },
    body: JSON.stringify(payload),
  }) as never
}
function realSig(payload: unknown): string {
  return createHmac('sha512', SECRET).update(canonicalNowpaymentsBody(payload)).digest('hex')
}

beforeEach(() => {
  vi.clearAllMocks()
  signatureOverride = true
  orderRow = {
    order_ref: 'ord_abc',
    status: 'pending',
    provider: 'nowpayments',
    price_amount: 5,
    price_currency: 'USD',
  }
  rpcResult = { data: 'ok', error: null }
})
afterEach(() => {
  delete process.env.NOWPAYMENTS_IPN_SECRET
})

describe('POST /api/webhooks/foguitos/nowpayments', () => {
  it('firma inválida → 401 + purchase_foguitos NO se llama', async () => {
    signatureOverride = false
    const res = await POST(makeReq(basePayload, 'short'))
    expect(res.status).toBe(401)
    expect(rpcSpy).not.toHaveBeenCalled()
    expect(selectSpy).not.toHaveBeenCalled()
  })

  it('orden desconocida → 200, no credita, audita la alerta', async () => {
    orderRow = null
    const res = await POST(makeReq(basePayload))
    expect(res.status).toBe(200)
    expect(rpcSpy).not.toHaveBeenCalled()
    const evt = auditSpy.mock.calls.map((c) => (c[0] as Record<string, unknown>).eventType)
    expect(evt).toContain('foguitos_ipn_unknown_order')
  })

  it('mismatch de monto → 200, no credita, audita el mismatch', async () => {
    const res = await POST(makeReq({ ...basePayload, price_amount: 5000 }))
    expect(res.status).toBe(200)
    expect(rpcSpy).not.toHaveBeenCalled()
    const evt = auditSpy.mock.calls.map((c) => (c[0] as Record<string, unknown>).eventType)
    expect(evt).toContain('foguitos_ipn_amount_mismatch')
  })

  it('mismatch de moneda → 200, no credita', async () => {
    const res = await POST(makeReq({ ...basePayload, price_currency: 'eur' }))
    expect(res.status).toBe(200)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('estado no final (waiting) → 200, no credita', async () => {
    const res = await POST(makeReq({ ...basePayload, payment_status: 'waiting' }))
    expect(res.status).toBe(200)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('estado confirming → 200, no credita', async () => {
    const res = await POST(makeReq({ ...basePayload, payment_status: 'confirming' }))
    expect(res.status).toBe(200)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('finished + firma válida + monto OK → purchase_foguitos(order_ref) + audit', async () => {
    const res = await POST(makeReq(basePayload))
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('purchase_foguitos', { p_order_ref: 'ord_abc' })
    const evt = auditSpy.mock.calls.map((c) => (c[0] as Record<string, unknown>).eventType)
    expect(evt).toContain('foguitos_purchased')
  })

  it('replay: la RPC devuelve already_applied → 200, sin re-audit de compra', async () => {
    rpcResult = { data: 'already_applied', error: null }
    const res = await POST(makeReq(basePayload))
    expect(res.status).toBe(200)
    // La RPC igual se llama (es idempotente); pero no se audita una compra nueva.
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    const evt = auditSpy.mock.calls.map((c) => (c[0] as Record<string, unknown>).eventType)
    expect(evt).not.toContain('foguitos_purchased')
  })

  it('error de la RPC en finished → 500 (para que el provider REINTENTE)', async () => {
    rpcResult = { data: null, error: { message: 'db down' } }
    const res = await POST(makeReq(basePayload))
    expect(res.status).toBe(500)
  })

  it('estado failed → marca la orden failed (sólo pending), no credita', async () => {
    const res = await POST(makeReq({ ...basePayload, payment_status: 'failed' }))
    expect(res.status).toBe(200)
    expect(rpcSpy).not.toHaveBeenCalled()
    const failedUpdate = updateSpy.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>)?.status === 'failed',
    )
    expect(failedUpdate).toBeTruthy()
  })

  it('estado expired → marca la orden expired, no credita', async () => {
    const res = await POST(makeReq({ ...basePayload, payment_status: 'expired' }))
    expect(res.status).toBe(200)
    expect(rpcSpy).not.toHaveBeenCalled()
    const expiredUpdate = updateSpy.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>)?.status === 'expired',
    )
    expect(expiredUpdate).toBeTruthy()
  })

  it('estado partially_paid → 200, no credita y NO estampa failed (NO es terminal)', async () => {
    // partially_paid NO es terminal en NOWPayments: el fan puede mandar el resto y
    // pasar a 'finished'. Si lo estampáramos failed, ese finished caería en
    // not_pending → cobrado sin crédito. Se ackea sin terminalizar.
    const res = await POST(makeReq({ ...basePayload, payment_status: 'partially_paid' }))
    expect(res.status).toBe(200)
    expect(rpcSpy).not.toHaveBeenCalled()
    const failedUpdate = updateSpy.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>)?.status === 'failed',
    )
    expect(failedUpdate).toBeFalsy()
  })

  // ── HMAC REAL (sin mockear la firma) ──────────────────────────────
  it('HMAC real: firma correcta + secreto configurado → credita', async () => {
    signatureOverride = null
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET
    const res = await POST(makeReq(basePayload, realSig(basePayload)))
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('purchase_foguitos', { p_order_ref: 'ord_abc' })
  })

  it('HMAC real: firma incorrecta → 401, no credita', async () => {
    signatureOverride = null
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET
    const res = await POST(makeReq(basePayload, realSig({ ...basePayload, price_amount: 9999 })))
    expect(res.status).toBe(401)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('HMAC real: sin secreto configurado → 401 (fail-closed)', async () => {
    signatureOverride = null
    delete process.env.NOWPAYMENTS_IPN_SECRET
    const res = await POST(makeReq(basePayload, realSig(basePayload)))
    expect(res.status).toBe(401)
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})
