// @vitest-environment node
/**
 * Contract tests for the identity-retention cron.
 *
 *   (c) Rows past `identity_purge_after` (and not yet purged) get their folder
 *       wiped and `identity_purged_at` stamped.
 *   (d) An unauthorized request (bad/missing CRON_SECRET) is rejected with 401.
 *   (e) Rows already purged are never selected — the cron skips them.
 *
 * Supabase admin + the purge helper are module-mocked so nothing touches the
 * network. The deletion_log query semantics (lte/is filters) are emulated in
 * the fake so "already purged" rows don't surface, matching the real route.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────
// Declared before the dynamic import of the route so the closures hook.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabaseScenario: any = null
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => supabaseScenario,
}))

// Purge helpers — replaced with spies so we assert which users were purged
// without exercising real storage. Default: every user removed 2 files.
const purgeSpy = vi.fn(async (_admin: unknown, _userId: string) => ({ removed: 2 }))
// Age-gate purge (PR-4) runs alongside the document purge; spy so the cron's
// call is satisfied and asserted without touching the DB.
const ageGatePurgeSpy = vi.fn(async (_admin: unknown, _userId: string) => ({ removed: 0 }))
vi.mock('@/lib/identity-retention', () => ({
  purgeIdentityDocuments: (admin: unknown, userId: string) => purgeSpy(admin, userId),
  purgeAgeGateVerifications: (admin: unknown, userId: string) => ageGatePurgeSpy(admin, userId),
}))

// ─── Helpers ───────────────────────────────────────────────────────────

interface LogRow {
  id: string
  user_id: string | null
  identity_purge_after: string | null
  identity_purged_at: string | null
}

/**
 * Build a fake admin client over a `deletion_log` table. The select chain
 * emulates `.lte('identity_purge_after', now).is('identity_purged_at', null)`
 * so only eligible rows are returned, and `.update().eq()` mutates the row in
 * place so the test can assert the stamp.
 */
function makeSupabase(rows: LogRow[]) {
  const now = Date.now()
  const make = () => {
    const filters: { dueOnly: boolean; pendingOnly: boolean } = { dueOnly: false, pendingOnly: false }
    let op: 'select' | 'update' = 'select'
    let payload: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {
      select: vi.fn(() => { op = 'select'; return builder }),
      update: vi.fn((p: Record<string, unknown>) => { op = 'update'; payload = p; return builder }),
      lte: vi.fn((col: string) => {
        // Emulate `.lte('identity_purge_after', now)` — only due rows survive.
        if (col === 'identity_purge_after') filters.dueOnly = true
        return builder
      }),
      is: vi.fn((col: string, val: unknown) => {
        if (col === 'identity_purged_at' && val === null) filters.pendingOnly = true
        return builder
      }),
      eq: vi.fn((col: string, val: unknown) => {
        if (op === 'update') {
          const target = rows.find(r => r[col as keyof LogRow] === val)
          if (target) Object.assign(target, payload)
        }
        return Promise.resolve({ data: null, error: null })
      }),
      // Thenable: awaiting the select chain resolves the filtered rows.
      then: (resolve: (v: { data: LogRow[]; error: null }) => unknown) => {
        const filtered = rows.filter(r => {
          const due = !filters.dueOnly || (r.identity_purge_after != null && Date.parse(r.identity_purge_after) <= now)
          const pending = !filters.pendingOnly || r.identity_purged_at == null
          return due && pending
        })
        return resolve({ data: filtered, error: null })
      },
    }
    return builder
  }
  return { from: vi.fn(() => make()) }
}

function makeRequest(secret: string | null): Request {
  const headers = new Headers()
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`)
  return new Request('https://example.com/api/cron/identity-retention', { headers })
}

// ─── Suite ───────────────────────────────────────────────────────────

const ORIGINAL_SECRET = process.env.CRON_SECRET

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  purgeSpy.mockResolvedValue({ removed: 2 })
})

describe('GET /api/cron/identity-retention', () => {
  it('(d) rejects an unauthorized request (bad CRON_SECRET)', async () => {
    supabaseScenario = makeSupabase([])
    const { GET } = await import('./route')

    const res = await GET(makeRequest('wrong-secret'))
    expect(res.status).toBe(401)
    expect(purgeSpy).not.toHaveBeenCalled()

    // Missing header entirely is also rejected.
    const res2 = await GET(makeRequest(null))
    expect(res2.status).toBe(401)
  })

  it('(c) purges rows past identity_purge_after and stamps identity_purged_at', async () => {
    const pastDue = new Date(Date.now() - 86400000).toISOString()
    const rows: LogRow[] = [
      { id: 'log-1', user_id: 'user-1', identity_purge_after: pastDue, identity_purged_at: null },
      { id: 'log-2', user_id: 'user-2', identity_purge_after: pastDue, identity_purged_at: null },
    ]
    supabaseScenario = makeSupabase(rows)
    const { GET } = await import('./route')

    const res = await GET(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.stats).toMatchObject({ eligible: 2, purged: 2, filesRemoved: 4, failed: 0 })

    expect(purgeSpy).toHaveBeenCalledTimes(2)
    expect(purgeSpy).toHaveBeenCalledWith(expect.anything(), 'user-1')
    expect(purgeSpy).toHaveBeenCalledWith(expect.anything(), 'user-2')

    // Age-gate verifications purged for both (PII minimization).
    expect(ageGatePurgeSpy).toHaveBeenCalledTimes(2)
    expect(ageGatePurgeSpy).toHaveBeenCalledWith(expect.anything(), 'user-1')
    expect(ageGatePurgeSpy).toHaveBeenCalledWith(expect.anything(), 'user-2')

    // Both rows stamped.
    expect(rows[0].identity_purged_at).toBeTruthy()
    expect(rows[1].identity_purged_at).toBeTruthy()
  })

  it('(e) skips rows already purged', async () => {
    const pastDue = new Date(Date.now() - 86400000).toISOString()
    const alreadyPurged = new Date(Date.now() - 1000).toISOString()
    const rows: LogRow[] = [
      { id: 'log-1', user_id: 'user-1', identity_purge_after: pastDue, identity_purged_at: null },
      { id: 'log-2', user_id: 'user-2', identity_purge_after: pastDue, identity_purged_at: alreadyPurged },
    ]
    supabaseScenario = makeSupabase(rows)
    const { GET } = await import('./route')

    const res = await GET(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    // Only the un-purged row is eligible.
    expect(body.stats).toMatchObject({ eligible: 1, purged: 1 })
    expect(purgeSpy).toHaveBeenCalledTimes(1)
    expect(purgeSpy).toHaveBeenCalledWith(expect.anything(), 'user-1')
    expect(purgeSpy).not.toHaveBeenCalledWith(expect.anything(), 'user-2')
  })

  it('keeps the row un-stamped when a purge throws (retried next run)', async () => {
    const pastDue = new Date(Date.now() - 86400000).toISOString()
    const rows: LogRow[] = [
      { id: 'log-1', user_id: 'user-1', identity_purge_after: pastDue, identity_purged_at: null },
    ]
    supabaseScenario = makeSupabase(rows)
    purgeSpy.mockRejectedValueOnce(new Error('storage down'))
    const { GET } = await import('./route')

    const res = await GET(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.stats).toMatchObject({ eligible: 1, purged: 0, failed: 1 })
    expect(rows[0].identity_purged_at).toBeNull()
  })
})

// Restore CRON_SECRET so we don't leak into other suites.
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = ORIGINAL_SECRET
})
