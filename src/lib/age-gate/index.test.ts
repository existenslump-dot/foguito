// @vitest-environment node
/**
 * Age-verify provider factory. Mirrors the CSAM factory test.
 *   - getAgeVerifyProvider() defaults to the stub, resolves 'stub' and 'didit',
 *     trims whitespace, and throws on an unknown provider id.
 *   - the didit skeleton is fail-closed (startVerification throws without creds).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { getAgeVerifyProvider } from './index'
import { StubAgeVerifyProvider } from './providers/stub'
import { DiditAgeVerifyProvider } from './providers/didit'

describe('getAgeVerifyProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to the stub when NEXT_PUBLIC_AGE_VERIFY_PROVIDER is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_AGE_VERIFY_PROVIDER', '')
    const p = getAgeVerifyProvider()
    expect(p).toBeInstanceOf(StubAgeVerifyProvider)
    expect(p.name).toBe('stub')
  })

  it('returns the stub when provider="stub"', () => {
    vi.stubEnv('NEXT_PUBLIC_AGE_VERIFY_PROVIDER', 'stub')
    expect(getAgeVerifyProvider()).toBeInstanceOf(StubAgeVerifyProvider)
  })

  it('trims surrounding whitespace', () => {
    vi.stubEnv('NEXT_PUBLIC_AGE_VERIFY_PROVIDER', '  stub  ')
    expect(getAgeVerifyProvider()).toBeInstanceOf(StubAgeVerifyProvider)
  })

  it('resolves the didit adapter when provider="didit"', () => {
    vi.stubEnv('NEXT_PUBLIC_AGE_VERIFY_PROVIDER', 'didit')
    expect(getAgeVerifyProvider()).toBeInstanceOf(DiditAgeVerifyProvider)
  })

  it('throws on an unknown provider', () => {
    vi.stubEnv('NEXT_PUBLIC_AGE_VERIFY_PROVIDER', 'yoti')
    expect(() => getAgeVerifyProvider()).toThrow(/Unknown NEXT_PUBLIC_AGE_VERIFY_PROVIDER="yoti"/)
  })

  it('the didit skeleton is fail-closed: startVerification throws when not configured', async () => {
    vi.stubEnv('AGE_VERIFY_API_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_AGE_VERIFY_PROVIDER', 'didit')
    const p = new DiditAgeVerifyProvider()
    await expect(
      p.startVerification({ userId: 'u1', jurisdiction: 'US-TX', callbackUrl: 'https://x/cb' }),
    ).rejects.toThrow(/not configured/)
  })
})
