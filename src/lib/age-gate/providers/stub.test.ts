// @vitest-environment node
/**
 * StubAgeVerifyProvider — deterministic dev URL, and FAIL-CLOSED in production
 * (startVerification throws so the stub can never certify age in prod).
 */
import { describe, it, expect, vi } from 'vitest'
import { StubAgeVerifyProvider } from './stub'

const provider = new StubAgeVerifyProvider()
const input = {
  userId: 'user-1',
  jurisdiction: 'US-TX',
  callbackUrl: 'https://example.com/cb',
}

describe('StubAgeVerifyProvider', () => {
  it('name is "stub"', () => {
    expect(provider.name).toBe('stub')
  })

  it('returns a deterministic internal dev URL (dev/CI)', async () => {
    const { url } = await provider.startVerification(input)
    expect(url).toContain('/verificar-edad')
    expect(url).toContain('provider=stub')
    expect(url).toContain('user=user-1')
    expect(url).toContain('jurisdiction=US-TX')
    // Deterministic: same input → same URL.
    const again = await provider.startVerification(input)
    expect(again.url).toBe(url)
  })

  it('FAIL-CLOSED in production: startVerification throws', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    await expect(provider.startVerification(input)).rejects.toThrow(/production/)
    vi.unstubAllEnvs()
  })
})
