// @vitest-environment node
/**
 * Tests de la verificación de firma del IPN de NOWPayments (PR-7 money-in).
 *
 * INVARIANTE: el único factor de confianza del webhook es esta firma. Se prueba
 * fail-closed en cada borde (secreto ausente, header ausente/corto, body
 * tampering, firma mal) y que la firma es determinística (mismo body → misma
 * firma pese al orden de las claves).
 *
 * NO se mockea nada: se computa el HMAC real con `crypto` y se compara.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import {
  verifyNowpaymentsSignature,
  sortKeysDeep,
  canonicalNowpaymentsBody,
  nowpaymentsHmacHex,
} from './signature'

const SECRET = 'ipn_test_secret'

/** Firma de referencia: HMAC-SHA512 hex del body canónico (claves ordenadas). */
function sign(payload: unknown, secret = SECRET): string {
  return createHmac('sha512', secret).update(canonicalNowpaymentsBody(payload)).digest('hex')
}

const basePayload = {
  payment_id: 5524759814,
  payment_status: 'finished',
  order_id: 'ord_abc',
  price_amount: 5,
  price_currency: 'usd',
  pay_amount: 4.9,
  actually_paid: 4.9,
  outcome: { amount: 4.9, currency: 'usdttrc20' },
}

describe('foguitos/signature · helpers', () => {
  it('sortKeysDeep ordena claves de objeto recursivamente y conserva arrays', () => {
    expect(sortKeysDeep({ b: 1, a: 2 })).toEqual({ a: 2, b: 1 })
    expect(JSON.stringify(sortKeysDeep({ b: 1, a: { z: 1, y: 2 } }))).toBe('{"a":{"y":2,"z":1},"b":1}')
    // Los arrays conservan su orden; sus elementos-objeto sí se ordenan.
    expect(JSON.stringify(sortKeysDeep([{ b: 1, a: 2 }, 3]))).toBe('[{"a":2,"b":1},3]')
  })

  it('canonicalNowpaymentsBody es estable ante el orden de las claves de entrada', () => {
    const a = canonicalNowpaymentsBody({ order_id: 'x', price_amount: 5 })
    const b = canonicalNowpaymentsBody({ price_amount: 5, order_id: 'x' })
    expect(a).toBe(b)
    expect(a).toBe('{"order_id":"x","price_amount":5}')
  })

  it('nowpaymentsHmacHex produce un SHA512 hex (128 chars)', () => {
    const hex = nowpaymentsHmacHex(basePayload, SECRET)
    expect(hex).toMatch(/^[0-9a-f]{128}$/)
  })
})

describe('foguitos/signature · verifyNowpaymentsSignature', () => {
  beforeEach(() => {
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET
  })
  afterEach(() => {
    delete process.env.NOWPAYMENTS_IPN_SECRET
  })

  it('acepta un body firmado con el secreto correcto', () => {
    const rawBody = JSON.stringify(basePayload)
    expect(verifyNowpaymentsSignature(rawBody, sign(basePayload))).toBe(true)
  })

  it('acepta aunque el body crudo tenga las claves en otro orden que el canónico', () => {
    // El body llega con las claves en un orden distinto al canónico; la firma se
    // computa sobre el canónico → igual verifica (re-canonicalizamos al verificar).
    const rawBody = JSON.stringify({
      outcome: { currency: 'usdttrc20', amount: 4.9 },
      price_currency: 'usd',
      order_id: 'ord_abc',
      payment_status: 'finished',
      price_amount: 5,
      pay_amount: 4.9,
      actually_paid: 4.9,
      payment_id: 5524759814,
    })
    expect(verifyNowpaymentsSignature(rawBody, sign(basePayload))).toBe(true)
  })

  it('rechaza un body tamperado (mismo header de firma)', () => {
    const tampered = JSON.stringify({ ...basePayload, price_amount: 5000 })
    expect(verifyNowpaymentsSignature(tampered, sign(basePayload))).toBe(false)
  })

  it('rechaza una firma con el secreto equivocado', () => {
    const rawBody = JSON.stringify(basePayload)
    expect(verifyNowpaymentsSignature(rawBody, sign(basePayload, 'otro_secreto'))).toBe(false)
  })

  it('rechaza un header ausente o demasiado corto (sin computar HMAC)', () => {
    const rawBody = JSON.stringify(basePayload)
    expect(verifyNowpaymentsSignature(rawBody, null)).toBe(false)
    expect(verifyNowpaymentsSignature(rawBody, '')).toBe(false)
    expect(verifyNowpaymentsSignature(rawBody, 'deadbeef')).toBe(false) // <16 chars
  })

  it('rechaza un hex de longitud equivocada (misma longitud es requisito del compare)', () => {
    const rawBody = JSON.stringify(basePayload)
    // Un hex válido pero corto (32 chars) nunca matchea un SHA512 (128 chars).
    expect(verifyNowpaymentsSignature(rawBody, 'a'.repeat(32))).toBe(false)
  })

  it('fail-closed: sin secreto configurado → false (nunca trata unsigned como válido)', () => {
    delete process.env.NOWPAYMENTS_IPN_SECRET
    const rawBody = JSON.stringify(basePayload)
    // Incluso con una firma "válida" para SECRET, sin secreto en el entorno → false.
    expect(verifyNowpaymentsSignature(rawBody, sign(basePayload))).toBe(false)
  })

  it('rechaza un body no-JSON', () => {
    expect(verifyNowpaymentsSignature('not json', sign(basePayload))).toBe(false)
  })

  it('rechaza un top-level no-objeto (array/escalar)', () => {
    const arr = JSON.stringify([1, 2, 3])
    expect(verifyNowpaymentsSignature(arr, sign([1, 2, 3]))).toBe(false)
  })
})
