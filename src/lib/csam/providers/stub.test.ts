// @vitest-environment node
/**
 * StubCsamProvider — determinístico, sin red. Cubre el mapeo sentinel→veredicto
 * y el orden de prioridad (possible_minor gana sobre known_hash/review).
 */
import { describe, it, expect } from 'vitest'
import { StubCsamProvider, CSAM_STUB_SENTINELS } from './stub'

const provider = new StubCsamProvider()

const input = (mediaRef: string, bytes?: Uint8Array) => ({
  contentId: 'c-1',
  mediaRef,
  mediaType: 'image',
  bytes,
})

describe('StubCsamProvider', () => {
  it('name is "stub"', () => {
    expect(provider.name).toBe('stub')
  })

  it('passes clean media (no sentinel)', async () => {
    const r = await provider.scan(input('creator-1/abc/media.jpg'))
    expect(r.verdict).toBe('pass')
    expect(r.matchType).toBeUndefined()
    expect(r.provider).toBe('stub')
  })

  it('blocks a known-hash sentinel in the mediaRef', async () => {
    const r = await provider.scan(input(`creator-1/${CSAM_STUB_SENTINELS.knownHash}/media.jpg`))
    expect(r.verdict).toBe('blocked')
    expect(r.matchType).toBe('known_hash')
  })

  it('blocks a possible-minor sentinel as a HARD HIT (classifier_possible_minor)', async () => {
    const r = await provider.scan(input(`creator-1/${CSAM_STUB_SENTINELS.possibleMinor}/media.jpg`))
    expect(r.verdict).toBe('blocked')
    expect(r.matchType).toBe('classifier_possible_minor')
  })

  it('routes a review sentinel to review (never auto-pass, no matchType)', async () => {
    const r = await provider.scan(input(`creator-1/${CSAM_STUB_SENTINELS.review}/media.jpg`))
    expect(r.verdict).toBe('review')
    expect(r.matchType).toBeUndefined()
  })

  it('prioritizes possible_minor over known_hash when both sentinels are present', async () => {
    const r = await provider.scan(
      input(`x/${CSAM_STUB_SENTINELS.knownHash}-${CSAM_STUB_SENTINELS.possibleMinor}/media.jpg`),
    )
    expect(r.matchType).toBe('classifier_possible_minor')
  })

  it('detects a sentinel embedded in the bytes', async () => {
    const bytes = new TextEncoder().encode(`binary...${CSAM_STUB_SENTINELS.knownHash}...`)
    const r = await provider.scan(input('creator-1/clean/media.bin', bytes))
    expect(r.verdict).toBe('blocked')
    expect(r.matchType).toBe('known_hash')
  })
})
