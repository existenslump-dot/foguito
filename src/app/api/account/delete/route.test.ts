// @vitest-environment node
/**
 * Identity-retention cascade tests for the account-delete route.
 *
 * These guard the privacy contract that closing an account schedules (or, with
 * IDENTITY_RETENTION_DAYS=0, immediately performs) the purge of the user's
 * private `identity-documents/{userId}/` folder:
 *
 *   - With the default retention window, the route stamps
 *     `identity_purge_after = now + N days` on the deletion_log row and leaves
 *     `identity_purged_at` null (the cron does the actual purge later).
 *   - With IDENTITY_RETENTION_DAYS=0, the route purges immediately and stamps
 *     `identity_purged_at`.
 *
 * Everything external (Cloudinary, Resend, audit log, same-origin guard) is
 * module-mocked so nothing touches the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabaseScenario: any = null
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => supabaseScenario,
}))

const purgeSpy = vi.fn(async () => ({ removed: 3 }))
vi.mock('@/lib/identity-retention', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identity-retention')>(
    '@/lib/identity-retention',
  )
  return {
    // Keep the real getIdentityRetentionDays (reads env) so the route's
    // immediate-vs-scheduled branch is exercised for real.
    getIdentityRetentionDays: actual.getIdentityRetentionDays,
    purgeIdentityDocuments: (...args: unknown[]) => purgeSpy(...(args as [])),
  }
})

vi.mock('@/lib/clients/same-origin', () => ({ isSameOrigin: () => true }))
vi.mock('@/lib/auditLog', () => ({ logAudit: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/post-assets', () => ({ collectPostAssetUrls: () => [] }))
vi.mock('@/lib/cloudinary.server', () => ({
  destroyCloudinaryAssets: vi.fn(() => Promise.resolve({ deleted: 0, failed: [] })),
}))
vi.mock('@/lib/emails', () => ({ renderEmail: (html: string) => html }))
vi.mock('@/lib/clients/resend', () => ({
  getResend: () => ({ emails: { send: vi.fn(() => Promise.resolve({})) } }),
}))

// ─── Helpers ───────────────────────────────────────────────────────────

const TEST_USER = { id: 'user-42', email: 'gone@example.com' }

/**
 * Fake admin client capturing the deletion_log insert and exposing the auth
 * surface the route needs (getUser + admin.deleteUser).
 */
function makeSupabase() {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  const client = {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        delete: vi.fn(() => builder),
        insert: vi.fn((payload: Record<string, unknown>) => {
          inserts.push({ table, payload })
          return Promise.resolve({ data: null, error: null })
        }),
        eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
      }
      return builder
    }),
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: TEST_USER }, error: null })),
      admin: { deleteUser: vi.fn(() => Promise.resolve({ data: null, error: null })) },
    },
  }
  return { client, inserts }
}

function makeRequest(): Request {
  return new Request('https://example.com/api/account/delete', {
    method: 'DELETE',
    headers: { authorization: 'Bearer token' },
  })
}

// ─── Suite ───────────────────────────────────────────────────────────

const ORIGINAL_DAYS = process.env.IDENTITY_RETENTION_DAYS

beforeEach(() => {
  vi.clearAllMocks()
  purgeSpy.mockResolvedValue({ removed: 3 })
})

afterEach(() => {
  if (ORIGINAL_DAYS === undefined) delete process.env.IDENTITY_RETENTION_DAYS
  else process.env.IDENTITY_RETENTION_DAYS = ORIGINAL_DAYS
})

describe('DELETE /api/account/delete — identity retention cascade', () => {
  it('schedules identity_purge_after and does NOT purge immediately (default window)', async () => {
    delete process.env.IDENTITY_RETENTION_DAYS // default 365
    const { client, inserts } = makeSupabase()
    supabaseScenario = client
    const { DELETE } = await import('./route')

    const before = Date.now()
    const res = await DELETE(makeRequest())
    const after = Date.now()
    expect(res.status).toBe(200)

    // No immediate purge under the default window.
    expect(purgeSpy).not.toHaveBeenCalled()

    const log = inserts.find(i => i.table === 'deletion_log')
    expect(log).toBeDefined()
    expect(log!.payload.user_id).toBe(TEST_USER.id)
    expect(log!.payload.identity_purged_at).toBeNull()

    // ~365 days out from "now".
    const purgeAfter = Date.parse(log!.payload.identity_purge_after as string)
    const expectedMin = before + 365 * 86400000 - 5000
    const expectedMax = after + 365 * 86400000 + 5000
    expect(purgeAfter).toBeGreaterThanOrEqual(expectedMin)
    expect(purgeAfter).toBeLessThanOrEqual(expectedMax)
  })

  it('purges immediately and stamps identity_purged_at when IDENTITY_RETENTION_DAYS=0', async () => {
    process.env.IDENTITY_RETENTION_DAYS = '0'
    const { client, inserts } = makeSupabase()
    supabaseScenario = client
    const { DELETE } = await import('./route')

    const res = await DELETE(makeRequest())
    expect(res.status).toBe(200)

    // Immediate purge of the user's folder.
    expect(purgeSpy).toHaveBeenCalledTimes(1)

    const log = inserts.find(i => i.table === 'deletion_log')
    expect(log).toBeDefined()
    expect(log!.payload.identity_purged_at).toBeTruthy()
    // purge_after == now (0-day window), already stamped.
    expect(log!.payload.identity_purge_after).toBeTruthy()
  })
})
