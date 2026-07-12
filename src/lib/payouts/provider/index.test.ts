// @vitest-environment node
/**
 * Providers de money-out (PR-8) — fail-closed:
 *   - Sanciones: el stub devuelve 'review' en PROD (NUNCA auto-clarea); en dev es
 *     determinístico ('clear' por default, sentinels 'hit'/'review'). El real tira.
 *   - Payout (VASP): el stub tira en PROD; el esqueleto real tira siempre.
 *   - Las factories eligen el real SÓLO con la env-key presente.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  VaspPayoutProvider,
  StubPayoutProvider,
  getPayoutProvider,
  VendorSanctionsProvider,
  StubSanctionsProvider,
  getSanctionsProvider,
} from './index'

const sendArgs = {
  creatorId: '11111111-1111-1111-1111-111111111111',
  amountUsdt: 5,
  beneficiary: { creatorId: '11111111-1111-1111-1111-111111111111' },
}

describe('payouts/provider — payout (VASP)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('stub: en dev devuelve un vaspTxId fake determinístico (sin red)', async () => {
    const r = await new StubPayoutProvider().sendPayout('pay-1', sendArgs)
    expect(r).toEqual({ vaspTxId: 'STUB-VASP-pay-1' })
  })

  it('stub: FAIL-CLOSED en producción — sendPayout tira (jamás transfiere)', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    await expect(new StubPayoutProvider().sendPayout('pay-1', sendArgs)).rejects.toThrow(
      /must not transfer in production/,
    )
  })

  it('real: esqueleto fail-closed — sendPayout tira (not implemented)', async () => {
    await expect(new VaspPayoutProvider().sendPayout('pay-1', sendArgs)).rejects.toThrow(
      /not implemented/,
    )
  })

  it('factory: stub sin PAYOUT_API_KEY, real con la key', () => {
    vi.stubEnv('PAYOUT_API_KEY', '')
    expect(getPayoutProvider()).toBeInstanceOf(StubPayoutProvider)
    vi.stubEnv('PAYOUT_API_KEY', 'k')
    expect(getPayoutProvider()).toBeInstanceOf(VaspPayoutProvider)
  })
})

describe('payouts/provider — sanciones', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('stub dev: default clear con ref determinístico (incluye subjectType)', async () => {
    const r = await new StubSanctionsProvider().screen({ subjectId: 'creator-abc', subjectType: 'creator' })
    expect(r.status).toBe('clear')
    expect(r.ref).toBe('STUB-SANCTIONS-creator-creator-abc')
  })

  it('stub dev: el ref refleja la superficie (consumer / payout)', async () => {
    const consumer = await new StubSanctionsProvider().screen({ subjectId: 'fan-1', subjectType: 'consumer' })
    expect(consumer.ref).toBe('STUB-SANCTIONS-consumer-fan-1')
    const payout = await new StubSanctionsProvider().screen({ subjectId: 'benef-1', subjectType: 'payout' })
    expect(payout.ref).toBe('STUB-SANCTIONS-payout-benef-1')
  })

  it('stub dev: sentinels en subjectId → hit / review', async () => {
    const hit = await new StubSanctionsProvider().screen({ subjectId: 'x-sanctions-hit-1', subjectType: 'consumer' })
    expect(hit.status).toBe('hit')
    const rev = await new StubSanctionsProvider().screen({ subjectId: 'x-sanctions-review-1', subjectType: 'creator' })
    expect(rev.status).toBe('review')
  })

  it('stub: FAIL-CLOSED en producción — SIEMPRE review (jamás auto-clear)', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    const r = await new StubSanctionsProvider().screen({ subjectId: 'creator-abc', subjectType: 'creator' })
    expect(r.status).toBe('review')
    expect(r.ref).toBe('STUB-SANCTIONS-creator-creator-abc')
  })

  it('stub: en prod ni siquiera un id "limpio" clarea', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const r = await new StubSanctionsProvider().screen({ subjectId: 'totally-clean-id', subjectType: 'consumer' })
    expect(r.status).not.toBe('clear')
  })

  it('real: esqueleto fail-closed — screen tira (not implemented)', async () => {
    await expect(
      new VendorSanctionsProvider().screen({ subjectId: 'creator-abc', subjectType: 'creator' }),
    ).rejects.toThrow(/not implemented/)
  })

  it('factory: stub sin SANCTIONS_API_KEY, real con la key', () => {
    vi.stubEnv('SANCTIONS_API_KEY', '')
    expect(getSanctionsProvider()).toBeInstanceOf(StubSanctionsProvider)
    vi.stubEnv('SANCTIONS_API_KEY', 'k')
    expect(getSanctionsProvider()).toBeInstanceOf(VendorSanctionsProvider)
  })
})
