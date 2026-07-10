// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import {
  verifyDiditWebhook,
  stableStringify,
  shortenFloats,
} from './webhook-verify'

const SECRET = 'whsec_test'
const NOW = 1_700_000_000 // fixed Unix seconds for the tests

function baseBody(extra: Record<string, unknown> = {}) {
  return {
    session_id: 'sess-1',
    status: 'Approved',
    webhook_type: 'status.updated',
    created_at: NOW,
    timestamp: NOW,
    vendor_data: 'user-1',
    decision: { face_match: { score: 97.0 }, liveness: { score: 92.5 } },
    ...extra,
  }
}

function v2Sig(body: unknown) {
  return createHmac('sha256', SECRET)
    .update(stableStringify(shortenFloats(body)), 'utf-8')
    .digest('hex')
}
function simpleSig(body: { timestamp: number; session_id: string; status: string; webhook_type: string }) {
  const canonical = [body.timestamp, body.session_id, body.status, body.webhook_type].join(':')
  return createHmac('sha256', SECRET).update(canonical, 'utf-8').digest('hex')
}
function originalSig(rawBody: string) {
  return createHmac('sha256', SECRET).update(rawBody).digest('hex')
}

describe('didit/webhook-verify · helpers', () => {
  it('shortenFloats collapses integer-floats but keeps real decimals', () => {
    expect(shortenFloats(12.0)).toBe(12)
    expect(shortenFloats(92.5)).toBe(92.5)
    expect(shortenFloats({ a: 1.0, b: [2.0, 3.5] })).toEqual({ a: 1, b: [2, 3.5] })
  })

  it('stableStringify sorts keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(stableStringify([{ z: 1, a: 2 }])).toBe('[{"a":2,"z":1}]')
  })
})

describe('didit/webhook-verify · verifyDiditWebhook', () => {
  it('accepts a valid V2 signature', () => {
    const body = baseBody()
    const r = verifyDiditWebhook({
      rawBody: JSON.stringify(body),
      body,
      signatures: { v2: v2Sig(body) },
      secret: SECRET,
      nowSeconds: NOW,
    })
    expect(r).toEqual({ ok: true, method: 'v2' })
  })

  it('accepts the simple signature when V2 is absent', () => {
    const body = baseBody()
    const r = verifyDiditWebhook({
      rawBody: JSON.stringify(body),
      body,
      signatures: { simple: simpleSig(body) },
      secret: SECRET,
      nowSeconds: NOW,
    })
    expect(r).toEqual({ ok: true, method: 'simple' })
  })

  it('accepts the original signature (raw body) as a last resort', () => {
    const body = baseBody()
    const rawBody = JSON.stringify(body)
    const r = verifyDiditWebhook({
      rawBody,
      body,
      signatures: { original: originalSig(rawBody) },
      secret: SECRET,
      nowSeconds: NOW,
    })
    expect(r).toEqual({ ok: true, method: 'original' })
  })

  it('falls back to simple if V2 is invalid but simple is valid', () => {
    const body = baseBody()
    const r = verifyDiditWebhook({
      rawBody: JSON.stringify(body),
      body,
      signatures: { v2: 'deadbeef', simple: simpleSig(body) },
      secret: SECRET,
      nowSeconds: NOW,
    })
    expect(r).toEqual({ ok: true, method: 'simple' })
  })

  it('rejects if all signatures are invalid', () => {
    const body = baseBody()
    const r = verifyDiditWebhook({
      rawBody: JSON.stringify(body),
      body,
      signatures: { v2: 'aa', simple: 'bb', original: 'cc' },
      secret: SECRET,
      nowSeconds: NOW,
    })
    expect(r.ok).toBe(false)
  })

  it('rejects a timestamp outside the window (>300s)', () => {
    const body = baseBody()
    const r = verifyDiditWebhook({
      rawBody: JSON.stringify(body),
      body,
      signatures: { v2: v2Sig(body) },
      secret: SECRET,
      nowSeconds: NOW + 301,
    })
    expect(r).toEqual({ ok: false, reason: 'stale or missing timestamp' })
  })

  it('rejects if created_at is missing', () => {
    const body = baseBody({ created_at: undefined })
    const r = verifyDiditWebhook({
      rawBody: JSON.stringify(body),
      body,
      signatures: { v2: v2Sig(body) },
      secret: SECRET,
      nowSeconds: NOW,
    })
    expect(r.ok).toBe(false)
  })

  it('rejects without a secret', () => {
    const body = baseBody()
    const r = verifyDiditWebhook({
      rawBody: JSON.stringify(body),
      body,
      signatures: { v2: v2Sig(body) },
      secret: '',
      nowSeconds: NOW,
    })
    expect(r).toEqual({ ok: false, reason: 'no secret configured' })
  })
})
