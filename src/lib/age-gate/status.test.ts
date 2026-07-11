// @vitest-environment node
/**
 * hasValidVerification — server-authoritative gate check. Mocks the Supabase
 * query builder (from→select→eq→or resolves to {data,error}).
 *
 * Covers: no user (fail-closed), a valid non-expired row, an expired-only set,
 * a query error (fail-closed), and the strict/compat rank rule
 * (an age_gate proof must NOT satisfy a verify_required jurisdiction).
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasValidVerification } from './status'

type Row = { jurisdiction: string | null; expires_at: string | null }

/** Fake client: the `or(...)` terminal resolves to what the test provides. */
function fakeClient(result: { data: Row[] | null; error: unknown }) {
  const or = vi.fn(() => Promise.resolve(result))
  const eq = vi.fn(() => ({ or }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as unknown as SupabaseClient, from, select, eq, or }
}

describe('hasValidVerification', () => {
  it('returns false with no user (fail-closed, no query)', async () => {
    const { client, from } = fakeClient({ data: [], error: null })
    expect(await hasValidVerification(client, null, 'US-TX')).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })

  it('returns true for a valid non-expired row in the same jurisdiction', async () => {
    const { client } = fakeClient({
      data: [{ jurisdiction: 'US-TX', expires_at: null }],
      error: null,
    })
    expect(await hasValidVerification(client, 'u1', 'US-TX')).toBe(true)
  })

  it('queries age_gate_verifications scoped to the user', async () => {
    const { client, from, eq } = fakeClient({ data: [{ jurisdiction: 'BR', expires_at: null }], error: null })
    await hasValidVerification(client, 'u1', 'BR')
    expect(from).toHaveBeenCalledWith('age_gate_verifications')
    expect(eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('returns false when the DB filtered everything out (no rows)', async () => {
    const { client } = fakeClient({ data: [], error: null })
    expect(await hasValidVerification(client, 'u1', 'US-TX')).toBe(false)
  })

  it('fails closed on a query error', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } })
    expect(await hasValidVerification(client, 'u1', 'US-TX')).toBe(false)
  })

  it('a verify_required proof satisfies an age_gate viewer (stricter covers laxer)', async () => {
    const { client } = fakeClient({
      data: [{ jurisdiction: 'US-TX', expires_at: null }], // verify_required
      error: null,
    })
    expect(await hasValidVerification(client, 'u1', 'US-CA')).toBe(true) // age_gate
  })

  it('an age_gate proof does NOT satisfy a verify_required viewer (laxer cannot cover stricter)', async () => {
    const { client } = fakeClient({
      data: [{ jurisdiction: 'US-CA', expires_at: null }], // age_gate
      error: null,
    })
    expect(await hasValidVerification(client, 'u1', 'US-TX')).toBe(false) // verify_required
  })
})
