// @vitest-environment node
/**
 * Contract tests for the csam-scan cron.
 *   · Rejects an unauthorized request (bad/missing CRON_SECRET).
 *   · Claims each 'uploaded' row and runs scanAndApply, tallying outcomes.
 *   · A row it cannot claim (lost race) is skipped without scanning.
 *   · A thrown scan doesn't abort the batch (row left retriable).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabaseScenario: any = null
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => supabaseScenario,
}))

type Outcome =
  | { ok: true; status: 'pass' | 'review' | 'blocked' | 'skipped'; reason?: string }
  | { ok: false; status: 'error'; reason?: string }
const claimSpy = vi.fn(async (_admin: unknown, _id: string) => true)
const scanSpy = vi.fn(async (_admin: unknown, _id: string): Promise<Outcome> => ({ ok: true, status: 'pass' }))
vi.mock('@/lib/csam/scan', () => ({
  claimForScan: (a: unknown, id: string) => claimSpy(a, id),
  scanAndApply: (a: unknown, id: string) => scanSpy(a, id),
}))

function makeSupabase(rows: Array<{ id: string }>) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return { from: vi.fn(() => builder) }
}

function makeRequest(secret: string | null): Request {
  const headers = new Headers()
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`)
  return new Request('https://example.com/api/cron/csam-scan', { headers })
}

const ORIGINAL_SECRET = process.env.CRON_SECRET

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  claimSpy.mockResolvedValue(true)
  scanSpy.mockResolvedValue({ ok: true, status: 'pass' })
})

describe('GET /api/cron/csam-scan', () => {
  it('rejects an unauthorized request', async () => {
    supabaseScenario = makeSupabase([])
    const { GET } = await import('./route')
    expect((await GET(makeRequest('wrong'))).status).toBe(401)
    expect((await GET(makeRequest(null))).status).toBe(401)
    expect(claimSpy).not.toHaveBeenCalled()
  })

  it('claims + scans each uploaded row and tallies outcomes', async () => {
    supabaseScenario = makeSupabase([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }])
    scanSpy
      .mockResolvedValueOnce({ ok: true, status: 'pass' })
      .mockResolvedValueOnce({ ok: true, status: 'blocked' })
      .mockResolvedValueOnce({ ok: false, status: 'error' })
    const { GET } = await import('./route')

    const res = await GET(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.stats).toMatchObject({ candidates: 3, claimed: 3, pass: 1, blocked: 1, failed: 1 })
    expect(claimSpy).toHaveBeenCalledTimes(3)
    expect(scanSpy).toHaveBeenCalledTimes(3)
  })

  it('skips a row it cannot claim (lost race) without scanning it', async () => {
    supabaseScenario = makeSupabase([{ id: 'c1' }, { id: 'c2' }])
    claimSpy.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { GET } = await import('./route')

    const res = await GET(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(body.stats).toMatchObject({ candidates: 2, claimed: 1, pass: 1 })
    expect(scanSpy).toHaveBeenCalledTimes(1)
    expect(scanSpy).toHaveBeenCalledWith(expect.anything(), 'c2')
  })

  it('a thrown scan does not abort the batch', async () => {
    supabaseScenario = makeSupabase([{ id: 'c1' }, { id: 'c2' }])
    scanSpy.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ ok: true, status: 'pass' })
    const { GET } = await import('./route')

    const res = await GET(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.stats).toMatchObject({ candidates: 2, claimed: 2, failed: 1, pass: 1 })
  })
})

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = ORIGINAL_SECRET
})
