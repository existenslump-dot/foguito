// @vitest-environment node
/**
 * age-gate config — activation flag + secret getters. `server-only` is aliased
 * to a stub in vitest so these can run in isolation.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  isAgeVerifyEnabled,
  isProduction,
  ageVerifyApiKey,
  ageVerifyWebhookSecret,
} from './config'

describe('age-gate/config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('isAgeVerifyEnabled requires BOTH AGE_VERIFY_API_KEY and NEXT_PUBLIC_AGE_VERIFY_PROVIDER', () => {
    vi.stubEnv('AGE_VERIFY_API_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_AGE_VERIFY_PROVIDER', '')
    expect(isAgeVerifyEnabled()).toBe(false)

    vi.stubEnv('AGE_VERIFY_API_KEY', 'k')
    vi.stubEnv('NEXT_PUBLIC_AGE_VERIFY_PROVIDER', '')
    expect(isAgeVerifyEnabled()).toBe(false)

    vi.stubEnv('AGE_VERIFY_API_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_AGE_VERIFY_PROVIDER', 'didit')
    expect(isAgeVerifyEnabled()).toBe(false)

    vi.stubEnv('AGE_VERIFY_API_KEY', 'k')
    vi.stubEnv('NEXT_PUBLIC_AGE_VERIFY_PROVIDER', 'didit')
    expect(isAgeVerifyEnabled()).toBe(true)
  })

  it('isProduction is true only on VERCEL_ENV=production', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(isProduction()).toBe(true)
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(isProduction()).toBe(false)
    vi.stubEnv('VERCEL_ENV', '')
    expect(isProduction()).toBe(false)
  })

  it('getters return the env value when present', () => {
    vi.stubEnv('AGE_VERIFY_API_KEY', 'api-key')
    vi.stubEnv('AGE_VERIFY_WEBHOOK_SECRET', 'wh-secret')
    expect(ageVerifyApiKey()).toBe('api-key')
    expect(ageVerifyWebhookSecret()).toBe('wh-secret')
  })

  it('getters throw when their env var is missing', () => {
    vi.stubEnv('AGE_VERIFY_API_KEY', '')
    vi.stubEnv('AGE_VERIFY_WEBHOOK_SECRET', '')
    expect(() => ageVerifyApiKey()).toThrow(/AGE_VERIFY_API_KEY/)
    expect(() => ageVerifyWebhookSecret()).toThrow(/AGE_VERIFY_WEBHOOK_SECRET/)
  })
})
