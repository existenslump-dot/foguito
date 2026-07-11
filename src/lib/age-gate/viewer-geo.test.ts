// @vitest-environment node
/**
 * getViewerJurisdiction — reads Vercel geo headers, uppercases, fails closed to
 * null on missing/blank (never invents a country).
 */
import { describe, it, expect } from 'vitest'
import { getViewerJurisdiction } from './viewer-geo'

/** Build a HeadersLike from a plain map (case-insensitive lookup like Headers). */
function h(map: Record<string, string>) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v
  return { get: (name: string) => lower[name.toLowerCase()] ?? null }
}

describe('getViewerJurisdiction', () => {
  it('reads country + region from the Vercel headers', () => {
    const r = getViewerJurisdiction(
      h({ 'x-vercel-ip-country': 'US', 'x-vercel-ip-country-region': 'TX' }),
    )
    expect(r).toEqual({ country: 'US', region: 'TX' })
  })

  it('uppercases lowercase header values', () => {
    const r = getViewerJurisdiction(
      h({ 'x-vercel-ip-country': 'br', 'x-vercel-ip-country-region': 'sp' }),
    )
    expect(r).toEqual({ country: 'BR', region: 'SP' })
  })

  it('trims surrounding whitespace', () => {
    const r = getViewerJurisdiction(
      h({ 'x-vercel-ip-country': '  gb  ', 'x-vercel-ip-country-region': '  eng ' }),
    )
    expect(r).toEqual({ country: 'GB', region: 'ENG' })
  })

  it('fails closed to null country when the header is missing (never invents one)', () => {
    const r = getViewerJurisdiction(h({}))
    expect(r).toEqual({ country: null, region: null })
  })

  it('treats a blank country as null', () => {
    const r = getViewerJurisdiction(h({ 'x-vercel-ip-country': '   ' }))
    expect(r.country).toBeNull()
  })

  it('returns a country with a null region when only the region is missing', () => {
    const r = getViewerJurisdiction(h({ 'x-vercel-ip-country': 'US' }))
    expect(r).toEqual({ country: 'US', region: null })
  })
})
