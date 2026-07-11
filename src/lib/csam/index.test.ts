// @vitest-environment node
/**
 * CSAM provider factory. Mirrors the KYC factory test.
 *   - getCsamProvider() defaults to the stub, resolves 'stub' and 'thorn-safer',
 *     trims whitespace, and throws on an unknown vendor id.
 *   - the thorn-safer skeleton is fail-closed (scan throws when not configured).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { getCsamProvider } from './index'
import { StubCsamProvider } from './providers/stub'
import { ThornSaferProvider } from './providers/thorn-safer'

describe('getCsamProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to the stub provider when CSAM_VENDOR is unset', () => {
    vi.stubEnv('CSAM_VENDOR', '')
    const p = getCsamProvider()
    expect(p).toBeInstanceOf(StubCsamProvider)
    expect(p.name).toBe('stub')
  })

  it('returns the stub when CSAM_VENDOR="stub"', () => {
    vi.stubEnv('CSAM_VENDOR', 'stub')
    expect(getCsamProvider()).toBeInstanceOf(StubCsamProvider)
  })

  it('trims surrounding whitespace in CSAM_VENDOR', () => {
    vi.stubEnv('CSAM_VENDOR', '  stub  ')
    expect(getCsamProvider()).toBeInstanceOf(StubCsamProvider)
  })

  it('resolves the thorn-safer skeleton when CSAM_VENDOR="thorn-safer"', () => {
    vi.stubEnv('CSAM_VENDOR', 'thorn-safer')
    expect(getCsamProvider()).toBeInstanceOf(ThornSaferProvider)
  })

  it('throws on an unknown CSAM_VENDOR', () => {
    vi.stubEnv('CSAM_VENDOR', 'photodna')
    expect(() => getCsamProvider()).toThrow(/Unknown CSAM_VENDOR="photodna"/)
  })

  it('the thorn-safer skeleton is fail-closed: scan throws when not configured', async () => {
    vi.stubEnv('CSAM_API_KEY', '')
    vi.stubEnv('CSAM_VENDOR', 'thorn-safer')
    const p = new ThornSaferProvider()
    await expect(
      p.scan({ contentId: 'c', mediaRef: 'x', mediaType: 'image' }),
    ).rejects.toThrow(/not configured/)
  })
})
