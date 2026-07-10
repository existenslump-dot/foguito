// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { getActiveSubscription, resolvePostDurationDays } from './subscriptions'

/**
 * Chainable Supabase query mock: every builder method returns `this`,
 * `maybeSingle` resolves with the canned result.
 */
function makeClient(result: { data: unknown; error: unknown } | Error) {
  const maybeSingle = result instanceof Error
    ? vi.fn(() => Promise.reject(result))
    : vi.fn(() => Promise.resolve(result))
  const builder: Record<string, unknown> = { maybeSingle }
  for (const m of ['select', 'eq', 'gt', 'order', 'limit']) {
    builder[m] = vi.fn(() => builder)
  }
  const from = vi.fn(() => builder)
  return { client: { from } as never, from, builder }
}

const SUB = { duration_days: 15, tier: 'bronze', expires_at: '2026-08-01T00:00:00Z' }

describe('getActiveSubscription', () => {
  it('returns the active subscription row', async () => {
    const { client, from } = makeClient({ data: SUB, error: null })
    expect(await getActiveSubscription(client, 'user-1')).toEqual(SUB)
    expect(from).toHaveBeenCalledWith('user_subscriptions')
  })

  it('returns null without querying when there is no user id', async () => {
    const { client, from } = makeClient({ data: SUB, error: null })
    expect(await getActiveSubscription(client, null)).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it('returns null on query error (fail-open)', async () => {
    const { client } = makeClient({ data: null, error: { message: 'rls' } })
    expect(await getActiveSubscription(client, 'user-1')).toBeNull()
  })

  it('returns null on a thrown/network error (fail-open)', async () => {
    const { client } = makeClient(new Error('offline'))
    expect(await getActiveSubscription(client, 'user-1')).toBeNull()
  })
})

describe('resolvePostDurationDays', () => {
  it("uses the subscription's duration", async () => {
    const { client } = makeClient({ data: SUB, error: null })
    expect(await resolvePostDurationDays(client, 'user-1')).toBe(15)
  })

  it('falls back to 30 when there is no active subscription', async () => {
    const { client } = makeClient({ data: null, error: null })
    expect(await resolvePostDurationDays(client, 'user-1')).toBe(30)
  })

  it('falls back to 30 on malformed duration values', async () => {
    const { client } = makeClient({ data: { ...SUB, duration_days: 0 }, error: null })
    expect(await resolvePostDurationDays(client, 'user-1')).toBe(30)
  })
})
