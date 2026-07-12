// @vitest-environment node
/**
 * Tests del provider de money-in (PR-7): factory + stub-en-prod fail-closed.
 *
 * Invariantes:
 *   - Sin credenciales → factory devuelve el stub (dev/CI): createCheckout da una
 *     dirección fake determinística.
 *   - Con credenciales → factory devuelve el adapter real, cuyo createCheckout es
 *     un esqueleto que TIRA (fail-closed) hasta que se cablee el POST real.
 *   - El stub NUNCA cobra en producción: en prod createCheckout TIRA.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getFoguitoPaymentProvider,
  StubFoguitoProvider,
  NowpaymentsFoguitoProvider,
} from './index'
import type { FoguitoPack } from '../packs'

const PACK: FoguitoPack = { id: 'pack_500', foguitos: 500, priceAmount: 5, priceCurrency: 'USD' }

const savedVercelEnv = process.env.VERCEL_ENV
const savedApiKey = process.env.NOWPAYMENTS_API_KEY

beforeEach(() => {
  delete process.env.VERCEL_ENV
  delete process.env.NOWPAYMENTS_API_KEY
})
afterEach(() => {
  if (savedVercelEnv === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = savedVercelEnv
  if (savedApiKey === undefined) delete process.env.NOWPAYMENTS_API_KEY
  else process.env.NOWPAYMENTS_API_KEY = savedApiKey
})

describe('foguitos/provider · factory', () => {
  it('sin credenciales → stub', () => {
    expect(getFoguitoPaymentProvider()).toBeInstanceOf(StubFoguitoProvider)
  })

  it('con NOWPAYMENTS_API_KEY → adapter real (nowpayments)', () => {
    process.env.NOWPAYMENTS_API_KEY = 'np_key'
    const provider = getFoguitoPaymentProvider()
    expect(provider).toBeInstanceOf(NowpaymentsFoguitoProvider)
    expect(provider.name).toBe('nowpayments')
  })
})

describe('foguitos/provider · StubFoguitoProvider', () => {
  it('en dev/CI devuelve una dirección de pago fake determinística', async () => {
    const stub = new StubFoguitoProvider()
    const out = await stub.createCheckout('ord_xyz', PACK)
    expect(out).toEqual({ gatewayTxId: 'STUB-ord_xyz', payAddress: 'STUB', payUrl: null })
  })

  it('FAIL-CLOSED: en producción el stub TIRA (nunca cobra en prod)', async () => {
    process.env.VERCEL_ENV = 'production'
    const stub = new StubFoguitoProvider()
    await expect(stub.createCheckout('ord_xyz', PACK)).rejects.toThrow(/production/i)
  })
})

describe('foguitos/provider · NowpaymentsFoguitoProvider', () => {
  it('createCheckout es un esqueleto fail-closed: TIRA hasta cablear el POST real', async () => {
    const real = new NowpaymentsFoguitoProvider()
    await expect(real.createCheckout('ord_xyz', PACK)).rejects.toThrow(/not implemented/i)
  })
})
