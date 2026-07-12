// @vitest-environment node
/**
 * Travel Rule (PR-8) — assemble puro (originador plataforma / beneficiario
 * creadora) + stub determinístico que TIRA en prod; el real tira siempre.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  assembleTravelRuleInfo,
  submitTravelRule,
  getTravelRuleProvider,
  StubTravelRuleProvider,
  VaspTravelRuleProvider,
} from './travel-rule'

const payout = { id: 'pay-1', creatorId: 'creator-1', amountUsdt: 5 }
const creator = { userId: 'creator-1', legalName: 'Ada L.', country: 'AR' }

describe('travel-rule', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('assemble: originador = plataforma, beneficiario = creadora', () => {
    const info = assembleTravelRuleInfo(payout, creator)
    expect(info.originator.type).toBe('platform')
    expect(info.beneficiary.creatorId).toBe('creator-1')
    expect(info.beneficiary.legalName).toBe('Ada L.')
    expect(info.payoutRef).toBe('pay-1')
    expect(info.asset).toBe('USDT')
    expect(info.amountUsdt).toBe(5)
  })

  it('assemble: campos faltantes del beneficiario → null (no undefined)', () => {
    const info = assembleTravelRuleInfo(payout, { userId: 'creator-1' })
    expect(info.beneficiary.legalName).toBeNull()
    expect(info.beneficiary.country).toBeNull()
    expect(info.beneficiary.walletAddress).toBeNull()
  })

  it('stub dev: submit → ref determinístico STUB-TR-<ref>', async () => {
    const r = await new StubTravelRuleProvider().submit(assembleTravelRuleInfo(payout, creator))
    expect(r.ref).toBe('STUB-TR-pay-1')
  })

  it('stub: FAIL-CLOSED en producción — submit tira', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    await expect(
      new StubTravelRuleProvider().submit(assembleTravelRuleInfo(payout, creator)),
    ).rejects.toThrow(/must not run in production/)
  })

  it('real: esqueleto fail-closed — submit tira (not implemented)', async () => {
    await expect(
      new VaspTravelRuleProvider().submit(assembleTravelRuleInfo(payout, creator)),
    ).rejects.toThrow(/not implemented/)
  })

  it('factory + submitTravelRule: stub sin key, delega el submit', async () => {
    vi.stubEnv('TRAVEL_RULE_API_KEY', '')
    expect(getTravelRuleProvider()).toBeInstanceOf(StubTravelRuleProvider)
    const r = await submitTravelRule(assembleTravelRuleInfo(payout, creator))
    expect(r.ref).toBe('STUB-TR-pay-1')
  })

  it('factory: real con TRAVEL_RULE_API_KEY', () => {
    vi.stubEnv('TRAVEL_RULE_API_KEY', 'k')
    expect(getTravelRuleProvider()).toBeInstanceOf(VaspTravelRuleProvider)
  })
})
