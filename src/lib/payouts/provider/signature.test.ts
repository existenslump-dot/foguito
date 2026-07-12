// @vitest-environment node
/**
 * Firma del webhook de settlement del VASP (PR-8) — HMAC-SHA256 sobre el body
 * crudo, constant-time, fail-closed. Test con HMAC REAL.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import { verifyPayoutWebhookSignature, payoutWebhookHmacHex } from './signature'

const SECRET = 'payout_test_secret'
const body = JSON.stringify({ payout_ref: 'pay-1', status: 'settled', vasp_tx_id: 'tx-9' })

function sig(raw: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
}

describe('verifyPayoutWebhookSignature', () => {
  afterEach(() => {
    delete process.env.PAYOUT_WEBHOOK_SECRET
  })

  it('firma correcta + secreto configurado → true', () => {
    process.env.PAYOUT_WEBHOOK_SECRET = SECRET
    expect(verifyPayoutWebhookSignature(body, sig(body))).toBe(true)
  })

  it('tolera el prefijo sha256= en el header', () => {
    process.env.PAYOUT_WEBHOOK_SECRET = SECRET
    expect(verifyPayoutWebhookSignature(body, `sha256=${sig(body)}`)).toBe(true)
  })

  it('firma incorrecta (otro body) → false', () => {
    process.env.PAYOUT_WEBHOOK_SECRET = SECRET
    expect(verifyPayoutWebhookSignature(body, sig(body + 'x'))).toBe(false)
  })

  it('secreto equivocado → false', () => {
    process.env.PAYOUT_WEBHOOK_SECRET = SECRET
    expect(verifyPayoutWebhookSignature(body, sig(body, 'wrong'))).toBe(false)
  })

  it('FAIL-CLOSED: sin secreto configurado → false (aunque la firma "matchee")', () => {
    delete process.env.PAYOUT_WEBHOOK_SECRET
    expect(verifyPayoutWebhookSignature(body, sig(body))).toBe(false)
  })

  it('header ausente o basura → false', () => {
    process.env.PAYOUT_WEBHOOK_SECRET = SECRET
    expect(verifyPayoutWebhookSignature(body, null)).toBe(false)
    expect(verifyPayoutWebhookSignature(body, '')).toBe(false)
    expect(verifyPayoutWebhookSignature(body, 'short')).toBe(false)
  })

  it('payoutWebhookHmacHex es determinístico (mismo body+secret → mismo hex)', () => {
    expect(payoutWebhookHmacHex(body, SECRET)).toBe(payoutWebhookHmacHex(body, SECRET))
    expect(payoutWebhookHmacHex(body, SECRET)).toHaveLength(64)
  })
})
