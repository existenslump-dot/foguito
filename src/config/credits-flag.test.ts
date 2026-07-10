import { describe, expect, it, vi, beforeEach } from 'vitest'

// The config captures FEATURE_CREDITS into a module-scoped literal on first
// import (CREDITS_ENABLED = MARKETPLACE.features.credits), so each case sets
// the env, resets the module registry, and re-imports. This locks the seam:
// the credit lifecycle must be an env-driven flag, not a hardcoded constant —
// a deployment flips it via FEATURE_CREDITS.
async function importWithCredits(value: string | undefined) {
  vi.resetModules()
  if (value === undefined) delete process.env.FEATURE_CREDITS
  else process.env.FEATURE_CREDITS = value
  return import('./marketplace.config')
}

describe('CREDITS_ENABLED seam (FEATURE_CREDITS)', () => {
  beforeEach(() => { delete process.env.FEATURE_CREDITS })

  it('is off when the env is unset (default)', async () => {
    const { CREDITS_ENABLED, MARKETPLACE } = await importWithCredits(undefined)
    expect(CREDITS_ENABLED).toBe(false)
    expect(MARKETPLACE.features.credits).toBe(false)
  })

  it('is off for any value other than the literal "true"', async () => {
    expect((await importWithCredits('false')).CREDITS_ENABLED).toBe(false)
    expect((await importWithCredits('1')).CREDITS_ENABLED).toBe(false)
    expect((await importWithCredits('')).CREDITS_ENABLED).toBe(false)
  })

  it('turns on only when FEATURE_CREDITS=true', async () => {
    const { CREDITS_ENABLED, MARKETPLACE } = await importWithCredits('true')
    expect(CREDITS_ENABLED).toBe(true)
    expect(MARKETPLACE.features.credits).toBe(true)
  })
})
