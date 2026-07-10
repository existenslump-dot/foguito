// @vitest-environment node
/**
 * ManualKycProvider — the built-in homegrown verification flow.
 *
 * Covers:
 *   - startVerification → always { mode: 'internal' } (no vendor session).
 *   - getStatus → normalizes raw `profiles.verification_status` values to the
 *     canonical KycStatus, and fails open to 'unverified' (no client, no row,
 *     DB error, legacy/unknown value).
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ManualKycProvider } from './manual'
import type { KycProvider } from '../provider'

/**
 * Minimal stub of the Supabase builder chain used by getStatus:
 *   supabase.from('profiles').select(...).eq(...).maybeSingle()
 * resolves to `result`.
 */
function makeSupabase(result: { data: unknown; error: unknown }): SupabaseClient {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  }
  return { from: vi.fn(() => builder) } as unknown as SupabaseClient
}

describe('ManualKycProvider', () => {
  it('name is "manual"', () => {
    expect(new ManualKycProvider().name).toBe('manual')
  })

  it('startVerification returns { mode: "internal" }', async () => {
    const provider = new ManualKycProvider()
    await expect(provider.startVerification({ userId: 'u1' })).resolves.toEqual({
      mode: 'internal',
    })
  })

  it('does not implement handleCallback (manual flow is review-driven)', () => {
    // Typed through the interface — handleCallback is the optional webhook hook
    // the manual provider deliberately omits.
    const provider: KycProvider = new ManualKycProvider()
    expect(provider.handleCallback).toBeUndefined()
  })

  describe('getStatus normalizes raw verification_status', () => {
    it.each([
      ['pending', 'pending'],
      ['approved', 'approved'],
      ['rejected', 'rejected'],
    ] as const)('maps %s → %s', async (raw, expected) => {
      const supabase = makeSupabase({ data: { verification_status: raw }, error: null })
      const provider = new ManualKycProvider(supabase)
      await expect(provider.getStatus('u1')).resolves.toBe(expected)
    })

    it.each([
      ['unverified'],
      ['legacy_value'],
      [null],
      [undefined],
    ])('maps %s → unverified (never-started / legacy)', async (raw) => {
      const supabase = makeSupabase({ data: { verification_status: raw }, error: null })
      const provider = new ManualKycProvider(supabase)
      await expect(provider.getStatus('u1')).resolves.toBe('unverified')
    })

    it('returns unverified when no client is injected', async () => {
      await expect(new ManualKycProvider().getStatus('u1')).resolves.toBe('unverified')
    })

    it('returns unverified on DB error', async () => {
      const supabase = makeSupabase({ data: null, error: { message: 'boom' } })
      await expect(new ManualKycProvider(supabase).getStatus('u1')).resolves.toBe('unverified')
    })

    it('returns unverified when the row is missing', async () => {
      const supabase = makeSupabase({ data: null, error: null })
      await expect(new ManualKycProvider(supabase).getStatus('u1')).resolves.toBe('unverified')
    })
  })
})
