// @vitest-environment node
/**
 * Locks the Sprint 3 staleness cap on the FX fallback. If Frankfurter is
 * down AND the cached rates in Supabase are older than 72h, the endpoint
 * must 503 instead of quoting wildly-stale prices to payers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbRows: any[] | null = null
let fxWillFail = false

vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: dbRows, error: null }),
      }),
      upsert: () => Promise.resolve({ data: null, error: null }),
    }),
  }),
}))

// Stub fetch. Using globalThis.fetch assignment keeps it per-test and
// cleanly restored in afterEach.
const realFetch = globalThis.fetch

beforeEach(() => {
  dbRows = null
  fxWillFail = false
  // The route derives its target currencies from MARKETPLACE.market.currency
  // at module load. Run these tests under a non-USD market (ARS) so the FX
  // fetch/cache/staleness logic is exercised; resetModules re-reads the env.
  vi.resetModules()
  vi.stubEnv('MARKET_CURRENCY', 'ARS')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = vi.fn(() => {
    if (fxWillFail) return Promise.reject(new Error('network'))
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ rates: { CLP: 950, BRL: 5, ARS: 1200 } }),
    })
  })
})

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = realFetch
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

// ─── Tests ─────────────────────────────────────────────────────────────

describe('exchange-rates — staleness fallback', () => {
  it('returns cached rates when they are fresh (<6h)', async () => {
    dbRows = [
      { currency: 'CLP', rate: 950, updated_at: new Date(Date.now() - 60_000).toISOString() },
      { currency: 'BRL', rate: 5,   updated_at: new Date(Date.now() - 60_000).toISOString() },
      { currency: 'ARS', rate: 1200,updated_at: new Date(Date.now() - 60_000).toISOString() },
    ]

    const { GET } = await import('./route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cached).toBe(true)
    expect(body.rates.ARS).toBe(1200)
  })

  it('falls back to cache <=72h old when Frankfurter is down', async () => {
    fxWillFail = true
    // Simulate 48h-old cache — stale enough to trigger the external fetch,
    // but inside the 72h max-age cap, so we still serve it.
    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    dbRows = [
      { currency: 'CLP', rate: 940, updated_at: stale },
      { currency: 'BRL', rate: 4.9, updated_at: stale },
      { currency: 'ARS', rate: 1150,updated_at: stale },
    ]

    const { GET } = await import('./route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cached).toBe(true)
    expect(body.message).toMatch(/fallback/i)
    expect(body.rates.ARS).toBe(1150)
  })

  it('returns 503 when Frankfurter is down AND cache is older than 72h', async () => {
    // The key regression: earlier versions would happily serve weeks-old
    // rates. Now we refuse past the 72h cap.
    fxWillFail = true
    const veryStale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days
    dbRows = [
      { currency: 'CLP', rate: 900, updated_at: veryStale },
      { currency: 'BRL', rate: 4.5, updated_at: veryStale },
      { currency: 'ARS', rate: 900, updated_at: veryStale },
    ]

    const { GET } = await import('./route')
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toMatch(/stale/i)
  })

  it('returns 503 when Frankfurter is down AND no cache exists', async () => {
    fxWillFail = true
    dbRows = []

    const { GET } = await import('./route')
    const res = await GET()
    expect(res.status).toBe(503)
  })

  it('short-circuits with empty rates for a USD (base-currency) market', async () => {
    // Default market is USD → nothing to convert; no external call, no DB.
    vi.resetModules()
    vi.stubEnv('MARKET_CURRENCY', 'USD')

    const { GET } = await import('./route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rates).toEqual({})
    expect(body.cached).toBe(false)
    // No FX fetch should have happened.
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
