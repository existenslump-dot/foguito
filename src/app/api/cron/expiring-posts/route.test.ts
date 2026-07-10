// @vitest-environment node
/**
 * Contract tests for the expiry-audit pass of the expiring-posts cron:
 *   - one `post_expired` audit_log event per expired, unaudited post
 *   - the bookkeeping flag is stamped so the next run inserts nothing new
 *   - CRON_SECRET gates the route
 *
 * The reminder/credit sections are exercised implicitly (they run against
 * empty result sets); the credit branches stay off (FEATURE_CREDITS unset).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/clients/resend', () => ({
  getResend: () => ({ emails: { send: vi.fn(() => Promise.resolve(null)) } }),
}))
vi.mock('@/lib/emails', () => ({ renderEmail: (html: string) => html, FROM: 'x@example.com' }))
vi.mock('@/lib/concierge', () => ({
  whatsappUrl: () => null,
  whatsappRenewalMessage: () => '',
}))

type Row = Record<string, unknown>

/**
 * Chainable thenable fake, table-aware:
 *   - select on `posts` filtered by expiry_audited=false → the seeded rows
 *   - every other select → []
 *   - update on posts / insert on audit_log → recorded for assertions
 */
function makeFake(expiredRows: Row[]) {
  const auditInserts: Row[] = []
  const postUpdates: Array<{ patch: Row; id: unknown }> = []
  const client = {
    auditInserts,
    postUpdates,
    from(table: string) {
      let mode: 'select' | 'update' = 'select'
      let patch: Row | null = null
      const eqs: Array<[string, unknown]> = []
      const builder: Row = {}
      for (const m of ['select', 'gte', 'lte', 'lt', 'in', 'limit']) {
        builder[m] = () => builder
      }
      builder.update = (p: Row) => { mode = 'update'; patch = p; return builder }
      builder.eq = (col: string, val: unknown) => { eqs.push([col, val]); return builder }
      builder.insert = (row: Row) => {
        if (table === 'audit_log') auditInserts.push(row)
        return Promise.resolve({ data: null, error: null })
      }
      builder.then = (resolve: (v: unknown) => unknown) => {
        if (mode === 'update') {
          if (table === 'posts') {
            postUpdates.push({ patch: patch!, id: eqs.find(([c]) => c === 'id')?.[1] })
          }
          return Promise.resolve({ data: [], error: null }).then(resolve)
        }
        const isExpiryScan =
          table === 'posts' && eqs.some(([c, v]) => c === 'expiry_audited' && v === false)
        return Promise.resolve({ data: isExpiryScan ? expiredRows : [], error: null }).then(resolve)
      }
      return builder
    },
  }
  return client
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fake: any
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => fake,
}))

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  fake = makeFake([])
  process.env = { ...ORIGINAL_ENV, CRON_SECRET: 's3cret' }
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

async function run(auth?: string) {
  const { GET } = await import('./route')
  return GET(new Request('https://shop.example/api/cron/expiring-posts', {
    headers: auth ? { authorization: auth } : {},
  }))
}

describe('expiring-posts cron — expiry audit', () => {
  it('rejects calls without the cron secret', async () => {
    const res = await run()
    expect(res.status).toBe(401)
  })

  it('records one post_expired audit event per expired post and stamps the flag', async () => {
    fake = makeFake([
      { id: 'post-1', user_id: 'user-1', expires_at: '2026-07-01T00:00:00Z' },
      { id: 'post-2', user_id: 'user-2', expires_at: '2026-07-02T00:00:00Z' },
    ])
    const res = await run('Bearer s3cret')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stats.expiryAudited).toBe(2)

    expect(fake.auditInserts).toHaveLength(2)
    expect(fake.auditInserts[0]).toMatchObject({
      event_type: 'post_expired',
      actor_role: 'system',
      subject_type: 'post',
      subject_id: 'post-1',
      metadata: { post_owner_user_id: 'user-1', expired_at: '2026-07-01T00:00:00Z' },
    })

    // Bookkeeping: both rows flagged so the next run is a no-op.
    expect(fake.postUpdates).toEqual([
      { patch: { expiry_audited: true }, id: 'post-1' },
      { patch: { expiry_audited: true }, id: 'post-2' },
    ])
  })

  it('does nothing when no post crossed its expiry', async () => {
    const res = await run('Bearer s3cret')
    expect(res.status).toBe(200)
    expect((await res.json()).stats.expiryAudited).toBe(0)
    expect(fake.auditInserts).toHaveLength(0)
  })
})
