// @vitest-environment node
/**
 * Contract tests del webhook de settlement del VASP (PR-8 money-out).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ El único factor de confianza es la firma HMAC. Sin firma válida NO avanza   │
 * │ nada (401). settled→sent, failed→failed vía advance_payout (idempotente +   │
 * │ terminal-freeze en la RPC). Payout desconocido → 200 no-op. Replay → 200.   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * La firma se mockea vía override; con override en `null` corre el HMAC REAL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

const PAYOUT_ID = '33333333-3333-3333-3333-333333333333'
const SECRET = 'payout_test_secret'

// ── firma: override booleano; `null` ⇒ corre el HMAC real ───────────
let signatureOverride: boolean | null = true
vi.mock('@/lib/payouts/provider/signature', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/payouts/provider/signature')>()
  return {
    ...actual,
    verifyPayoutWebhookSignature: (rawBody: string, sig: string | null) =>
      signatureOverride === null ? actual.verifyPayoutWebhookSignature(rawBody, sig) : signatureOverride,
  }
})

// ── service-role: from().select().eq().maybeSingle() + rpc ───────────
let payoutRow: { id: string; status: string; creator_id: string } | null = {
  id: PAYOUT_ID,
  status: 'approved',
  creator_id: '11111111-1111-1111-1111-111111111111',
}
let rpcResult: { data: unknown; error: unknown } = { data: 'ok', error: null }
const rpcSpy = vi.fn((..._a: unknown[]) => Promise.resolve(rpcResult))
function makeChain(row: unknown) {
  const chain: Record<string, unknown> = {
    select: vi.fn((..._a: unknown[]) => chain),
    eq: vi.fn((..._a: unknown[]) => chain),
    maybeSingle: vi.fn((..._a: unknown[]) => Promise.resolve({ data: row, error: null })),
  }
  return chain
}
const fromSpy = vi.fn((..._a: unknown[]) => makeChain(payoutRow))
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: fromSpy, rpc: rpcSpy }),
}))

const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...a) }))

import { POST } from './route'
import { payoutWebhookHmacHex } from '@/lib/payouts/provider/signature'

const basePayload = { payout_ref: PAYOUT_ID, status: 'settled', vasp_tx_id: 'tx-9' }

function makeReq(payload: unknown, sig = 'x'.repeat(64)) {
  return new Request('https://example.com/api/webhooks/payouts', {
    method: 'POST',
    headers: { 'x-payout-signature': sig },
    body: JSON.stringify(payload),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  signatureOverride = true
  payoutRow = { id: PAYOUT_ID, status: 'approved', creator_id: '11111111-1111-1111-1111-111111111111' }
  rpcResult = { data: 'ok', error: null }
})
afterEach(() => {
  delete process.env.PAYOUT_WEBHOOK_SECRET
})

describe('POST /api/webhooks/payouts', () => {
  it('firma inválida → 401 + advance_payout NO se llama', async () => {
    signatureOverride = false
    const res = await POST(makeReq(basePayload, 'short'))
    expect(res.status).toBe(401)
    expect(rpcSpy).not.toHaveBeenCalled()
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('settled → advance_payout("sent", vaspTxId) → 200', async () => {
    const res = await POST(makeReq(basePayload))
    expect(res.status).toBe(200)
    const call = rpcSpy.mock.calls.find((c) => c[0] === 'advance_payout')?.[1] as Record<string, unknown>
    expect(call).toMatchObject({ p_payout: PAYOUT_ID, p_new_status: 'sent', p_vasp_tx_id: 'tx-9' })
  })

  it('failed → advance_payout("failed") → 200', async () => {
    const res = await POST(makeReq({ ...basePayload, status: 'failed' }))
    expect(res.status).toBe(200)
    const call = rpcSpy.mock.calls.find((c) => c[0] === 'advance_payout')?.[1] as Record<string, unknown>
    expect(call).toMatchObject({ p_new_status: 'failed' })
  })

  it('payout desconocido → 200 no-op + audit de alerta', async () => {
    payoutRow = null
    const res = await POST(makeReq(basePayload))
    expect(res.status).toBe(200)
    expect(rpcSpy).not.toHaveBeenCalled()
    const evt = auditSpy.mock.calls.map((c) => (c[0] as Record<string, unknown>).eventType)
    expect(evt).toContain('payout_webhook_unknown')
  })

  it('estado no-final (processing) → 200, no avanza', async () => {
    const res = await POST(makeReq({ ...basePayload, status: 'processing' }))
    expect(res.status).toBe(200)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('replay idempotente: la RPC devuelve "already" → 200', async () => {
    rpcResult = { data: 'already', error: null }
    const res = await POST(makeReq(basePayload))
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledTimes(1)
  })

  it('sin payout_ref → 200 no-op', async () => {
    const res = await POST(makeReq({ status: 'settled' }))
    expect(res.status).toBe(200)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('error de la RPC → 500 (para que el VASP REINTENTE)', async () => {
    rpcResult = { data: null, error: { message: 'db down' } }
    const res = await POST(makeReq(basePayload))
    expect(res.status).toBe(500)
  })

  // ── HMAC REAL (sin mockear la firma) ──────────────────────────────
  it('HMAC real: firma correcta + secreto configurado → avanza', async () => {
    signatureOverride = null
    process.env.PAYOUT_WEBHOOK_SECRET = SECRET
    const raw = JSON.stringify(basePayload)
    const res = await POST(makeReq(basePayload, payoutWebhookHmacHex(raw, SECRET)))
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalled()
  })

  it('HMAC real: firma incorrecta → 401, no avanza', async () => {
    signatureOverride = null
    process.env.PAYOUT_WEBHOOK_SECRET = SECRET
    const res = await POST(makeReq(basePayload, payoutWebhookHmacHex('otro', SECRET)))
    expect(res.status).toBe(401)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('HMAC real: sin secreto configurado → 401 (fail-closed)', async () => {
    signatureOverride = null
    delete process.env.PAYOUT_WEBHOOK_SECRET
    const raw = JSON.stringify(basePayload)
    const res = await POST(makeReq(basePayload, payoutWebhookHmacHex(raw, SECRET)))
    expect(res.status).toBe(401)
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})
