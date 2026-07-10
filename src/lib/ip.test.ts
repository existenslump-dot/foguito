import { describe, expect, it } from 'vitest'
import { getClientIp } from './ip'

function makeReq(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) }
}

describe('getClientIp', () => {
  it('returns the first IP from x-forwarded-for', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '203.0.113.5' }))).toBe('203.0.113.5')
  })

  it('strips chained proxy hops', () => {
    // XFF can carry a comma-separated chain — first entry is the
    // original client, everything after is each intermediate proxy.
    expect(getClientIp(makeReq({
      'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2',
    }))).toBe('203.0.113.5')
  })

  it('trims whitespace around entries', () => {
    expect(getClientIp(makeReq({
      'x-forwarded-for': '  203.0.113.5  , 10.0.0.1',
    }))).toBe('203.0.113.5')
  })

  it('falls back to x-real-ip when XFF is missing', () => {
    expect(getClientIp(makeReq({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('prefers x-forwarded-for over x-real-ip when both are present', () => {
    expect(getClientIp(makeReq({
      'x-forwarded-for': '203.0.113.5',
      'x-real-ip':       '198.51.100.7',
    }))).toBe('203.0.113.5')
  })

  it('returns "unknown" when no IP headers are present', () => {
    expect(getClientIp(makeReq({}))).toBe('unknown')
  })

  it('returns "unknown" when XFF is an empty string', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '' }))).toBe('unknown')
  })

  it('ignores an XFF that is only whitespace / commas', () => {
    // Malformed XFF shouldn't poison the rate-limit key — fall through
    // to x-real-ip or 'unknown' so attackers can't force a shared key.
    const r = getClientIp(makeReq({ 'x-forwarded-for': '   ,  ,  ' }))
    expect(r).toBe('unknown')
  })
})
