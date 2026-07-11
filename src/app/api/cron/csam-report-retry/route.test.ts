// @vitest-environment node
/**
 * Contract tests for the csam-report-retry cron.
 *   · Rejects an unauthorized request.
 *   · Retries every pending/failed incident and tallies reported vs failed.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabaseScenario: any = null
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => supabaseScenario,
}))

const reportSpy = vi.fn(async (_admin: unknown, _incident: unknown) => ({ ok: true }))
vi.mock('@/lib/csam/scan', () => ({
  reportIncidentToNcmec: (a: unknown, i: unknown) => reportSpy(a, i),
}))

function makeSupabase(rows: Array<Record<string, unknown>>) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return { from: vi.fn(() => builder) }
}

function makeRequest(secret: string | null): Request {
  const headers = new Headers()
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`)
  return new Request('https://example.com/api/cron/csam-report-retry', { headers })
}

const ORIGINAL_SECRET = process.env.CRON_SECRET

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  reportSpy.mockResolvedValue({ ok: true })
})

describe('GET /api/cron/csam-report-retry', () => {
  it('rejects an unauthorized request', async () => {
    supabaseScenario = makeSupabase([])
    const { GET } = await import('./route')
    expect((await GET(makeRequest('wrong'))).status).toBe(401)
    expect(reportSpy).not.toHaveBeenCalled()
  })

  it('retries each incident and tallies reported vs failed', async () => {
    supabaseScenario = makeSupabase([
      { id: 'inc-1', content_id: 'c1', creator_id: 'u1', verdict: 'blocked', match_type: 'known_hash', provider: 'stub', evidence_path: 'u1/c1/media' },
      { id: 'inc-2', content_id: 'c2', creator_id: 'u2', verdict: 'blocked', match_type: null, provider: 'stub', evidence_path: null },
    ])
    reportSpy.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false })
    const { GET } = await import('./route')

    const res = await GET(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.stats).toMatchObject({ candidates: 2, reported: 1, failed: 1 })
    expect(reportSpy).toHaveBeenCalledTimes(2)
    expect(reportSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ incidentId: 'inc-1', contentId: 'c1', provider: 'stub' }),
    )
  })
})

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = ORIGINAL_SECRET
})
