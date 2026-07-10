// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { applyPaymentActivation, type PaymentConfirmedEvent } from './activation'

const EVENT: PaymentConfirmedEvent = {
  provider: 'nowpayments',
  gatewayTxId: 'np-123',
  orderRef: 'ord_abc',
  packageId: 'tier_plus',
  credits: 99,
  amountUsd: 99,
  userId: 'user-1',
  payerEmail: 'payer@x.com',
}

function makeAdmin(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result))
  return { admin: { rpc } as never, rpc }
}

describe('applyPaymentActivation', () => {
  it('maps the event onto the rpc parameters', async () => {
    const { admin, rpc } = makeAdmin({ data: 'applied', error: null })
    const result = await applyPaymentActivation(admin, EVENT)
    expect(result).toBe('applied')
    expect(rpc).toHaveBeenCalledWith('apply_payment_activation', {
      p_gateway: 'nowpayments',
      p_gateway_tx_id: 'np-123',
      p_user_id: 'user-1',
      p_package_id: 'tier_plus',
      p_credits: 99,
      p_amount_usd: 99,
      p_payer_email: 'payer@x.com',
      p_order_ref: 'ord_abc',
      // Derived from the catalogue, not the event — see activation.ts.
      p_duration_days: 30,
      p_tier: 'bronze',
      // No renewal target on a plain purchase.
      p_renew_post_id: null,
    })
  })

  it('passes the renewal target through to the rpc', async () => {
    const { admin, rpc } = makeAdmin({ data: 'applied', error: null })
    await applyPaymentActivation(admin, { ...EVENT, renewPostId: 'post-9' })
    expect(rpc).toHaveBeenCalledWith(
      'apply_payment_activation',
      expect.objectContaining({ p_renew_post_id: 'post-9' }),
    )
  })

  it('derives the 15-day duration for the short-subscription packages', async () => {
    const { admin, rpc } = makeAdmin({ data: 'applied', error: null })
    await applyPaymentActivation(admin, {
      ...EVENT,
      packageId: 'tier_plus_15d',
      credits: 59,
      amountUsd: 59,
    })
    expect(rpc).toHaveBeenCalledWith(
      'apply_payment_activation',
      expect.objectContaining({ p_duration_days: 15, p_tier: 'bronze' }),
    )
  })

  it('falls back to 30 days / null tier for package ids not in the catalogue', async () => {
    const { admin, rpc } = makeAdmin({ data: 'applied', error: null })
    await applyPaymentActivation(admin, { ...EVENT, packageId: 'tier_ghost' })
    expect(rpc).toHaveBeenCalledWith(
      'apply_payment_activation',
      expect.objectContaining({ p_duration_days: 30, p_tier: null }),
    )
  })

  it.each(['applied', 'already-applied', 'no-user'] as const)(
    'passes through the %s rpc verdict',
    async (verdict) => {
      const { admin } = makeAdmin({ data: verdict, error: null })
      expect(await applyPaymentActivation(admin, EVENT)).toBe(verdict)
    },
  )

  it('returns error when the rpc fails — callers must not confirm fulfilment', async () => {
    const { admin } = makeAdmin({ data: null, error: { message: 'boom' } })
    expect(await applyPaymentActivation(admin, EVENT)).toBe('error')
  })

  it('returns error on an unexpected rpc result', async () => {
    const { admin } = makeAdmin({ data: 'wat', error: null })
    expect(await applyPaymentActivation(admin, EVENT)).toBe('error')
  })
})
