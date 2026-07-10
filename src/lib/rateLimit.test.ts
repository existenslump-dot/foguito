import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { rateLimit, __resetRateLimitForTests } from './rateLimit'

// These tests exercise the in-memory fallback path exclusively. The
// Upstash path is gated by UPSTASH_REDIS_REST_URL + _TOKEN being set —
// by not setting them, `getLimiter` returns null and `rateLimit` falls
// through to `memoryLimit`, which is deterministic and fast.
//
// Integration coverage for the Upstash path lives in the Upstash dashboard
// (we can watch request counts after deploy). Mocking Redis network calls
// here would only verify the library wiring, not the actual semantics.

describe('rateLimit — in-memory fallback', () => {
  beforeEach(() => {
    __resetRateLimitForTests()
    // Ensure Upstash stays disabled regardless of local .env shape
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-23T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows calls under the limit', async () => {
    for (let i = 0; i < 5; i++) {
      const { success, retryAfter } = await rateLimit('test:a', 5, 60_000)
      expect(success).toBe(true)
      expect(retryAfter).toBe(0)
    }
  })

  it('blocks the next call once limit is reached', async () => {
    for (let i = 0; i < 3; i++) {
      const { success } = await rateLimit('test:b', 3, 60_000)
      expect(success).toBe(true)
    }
    const { success, retryAfter } = await rateLimit('test:b', 3, 60_000)
    expect(success).toBe(false)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
  })

  it('isolates keys from one another', async () => {
    for (let i = 0; i < 3; i++) {
      await rateLimit('test:c', 3, 60_000)
    }
    // Key c is saturated…
    const blocked = await rateLimit('test:c', 3, 60_000)
    expect(blocked.success).toBe(false)
    // …but key d is fresh.
    const allowed = await rateLimit('test:d', 3, 60_000)
    expect(allowed.success).toBe(true)
  })

  it('resets after the window expires', async () => {
    for (let i = 0; i < 2; i++) {
      await rateLimit('test:e', 2, 1_000)
    }
    const blocked = await rateLimit('test:e', 2, 1_000)
    expect(blocked.success).toBe(false)

    // Advance past the 1-second window
    vi.advanceTimersByTime(1_100)

    const allowed = await rateLimit('test:e', 2, 1_000)
    expect(allowed.success).toBe(true)
    expect(allowed.retryAfter).toBe(0)
  })

  it('retryAfter counts down as time passes within the window', async () => {
    // Saturate with a 60s window
    for (let i = 0; i < 2; i++) {
      await rateLimit('test:f', 2, 60_000)
    }
    const first = await rateLimit('test:f', 2, 60_000)
    expect(first.success).toBe(false)
    const firstRetry = first.retryAfter

    // 30 seconds pass — retryAfter should roughly halve
    vi.advanceTimersByTime(30_000)
    const second = await rateLimit('test:f', 2, 60_000)
    expect(second.success).toBe(false)
    expect(second.retryAfter).toBeLessThan(firstRetry)
  })

  it('handles very short windows', async () => {
    const { success: ok } = await rateLimit('test:g', 1, 10)
    expect(ok).toBe(true)
    const { success: blocked, retryAfter } = await rateLimit('test:g', 1, 10)
    expect(blocked).toBe(false)
    expect(retryAfter).toBeGreaterThanOrEqual(0)
  })

  it('always returns a resolved result — never throws', async () => {
    // Degenerate inputs shouldn't crash the caller. The rate-limiter is
    // defense-in-depth; a bug here must not 500 the whole request.
    const r1 = await rateLimit('', 0, 1_000)
    expect(typeof r1.success).toBe('boolean')
    const r2 = await rateLimit('test:h', 1_000_000, 1_000_000)
    expect(r2.success).toBe(true)
  })
})

describe('rateLimit — env-gated Upstash selection', () => {
  beforeEach(() => {
    __resetRateLimitForTests()
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it('does NOT call Upstash when env vars are absent', async () => {
    // The fetch call Upstash SDK would make has no chance of firing —
    // getRedis() returns null before it can instantiate. We assert this
    // indirectly: a run with ten bursts inside a tight window behaves
    // exactly like the pre-migration in-memory limiter.
    for (let i = 0; i < 3; i++) {
      await rateLimit('envtest', 3, 60_000)
    }
    const blocked = await rateLimit('envtest', 3, 60_000)
    expect(blocked.success).toBe(false)
  })
})
