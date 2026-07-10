// @vitest-environment node
/**
 * KYC factory + feature helper.
 *
 * Covers:
 *   - getKycProvider() returns the built-in manual provider by default and
 *     when KYC_PROVIDER='manual'; throws on an unknown provider id.
 *   - kycEnabled() mirrors FEATURE_KYC (MARKETPLACE.features.kyc).
 *
 * FEATURE_KYC is resolved at module-load (marketplace.config), so the
 * kycEnabled() cases use vi.resetModules() + a fresh dynamic import after
 * stubbing the env, then restore.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getKycProvider } from './index'
import { ManualKycProvider } from './providers/manual'

describe('getKycProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to the manual provider when KYC_PROVIDER is unset', () => {
    vi.stubEnv('KYC_PROVIDER', '')
    const provider = getKycProvider()
    expect(provider).toBeInstanceOf(ManualKycProvider)
    expect(provider.name).toBe('manual')
  })

  it('returns the manual provider when KYC_PROVIDER="manual"', () => {
    vi.stubEnv('KYC_PROVIDER', 'manual')
    expect(getKycProvider()).toBeInstanceOf(ManualKycProvider)
  })

  it('trims surrounding whitespace in KYC_PROVIDER', () => {
    vi.stubEnv('KYC_PROVIDER', '  manual  ')
    expect(getKycProvider()).toBeInstanceOf(ManualKycProvider)
  })

  it('throws on an unknown KYC_PROVIDER', () => {
    vi.stubEnv('KYC_PROVIDER', 'didit')
    expect(() => getKycProvider()).toThrow(/Unknown KYC_PROVIDER="didit"/)
  })

  it('forwards an injected Supabase client to the manual provider', async () => {
    vi.stubEnv('KYC_PROVIDER', 'manual')
    // A client whose chain resolves to a known status proves it was wired in.
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn(() => Promise.resolve({ data: { verification_status: 'approved' }, error: null })),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = { from: vi.fn(() => builder) } as any
    const provider = getKycProvider(supabase)
    await expect(provider.getStatus('u1')).resolves.toBe('approved')
  })
})

describe('kycEnabled mirrors FEATURE_KYC', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('is true when FEATURE_KYC="true"', async () => {
    vi.resetModules()
    vi.stubEnv('FEATURE_KYC', 'true')
    const { kycEnabled } = await import('./index')
    expect(kycEnabled()).toBe(true)
  })

  it('is false when FEATURE_KYC is unset / not "true" (default)', async () => {
    vi.resetModules()
    vi.stubEnv('FEATURE_KYC', undefined)
    const { kycEnabled } = await import('./index')
    expect(kycEnabled()).toBe(false)
  })

  it('is false when FEATURE_KYC="false"', async () => {
    vi.resetModules()
    vi.stubEnv('FEATURE_KYC', 'false')
    const { kycEnabled } = await import('./index')
    expect(kycEnabled()).toBe(false)
  })
})
