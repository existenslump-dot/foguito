// @vitest-environment node
/**
 * Contract tests for the boost purchase route:
 *   - buyer comes from the session, never the body
 *   - cost/duration come from the server config, never the body
 *   - RPC verdicts map to the right HTTP statuses
 *   - inert (404) when the payments add-on is off
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'

let currentUser: string | null = 'user-1'
vi.mock('@/lib/clients/require-user', () => ({
  requireUser: () =>
    Promise.resolve(
      currentUser
        ? { ok: true, userId: currentUser }
        : { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) },
    ),
}))

let rpcResult: { data: unknown; error: unknown } = { data: 'applied', error: null }
const rpcMock = vi.fn(() => Promise.resolve(rpcResult))
const postRow: { boost_ends_at: string | null } = { boost_ends_at: '2026-07-13T00:00:00Z' }
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    rpc: rpcMock,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: postRow, error: null }) }),
      }),
    }),
  }),
}))

const ORIGINAL_ENV = { ...process.env }
const POST_ID = '7b8a0d7e-3a67-4b2f-9c81-2f8f6f0a1c11'
const IDEM_KEY = 'e0f9c1d2-4b5a-4c6d-8e7f-9a0b1c2d3e4f'

beforeEach(() => {
  vi.resetModules()
  currentUser = 'user-1'
  rpcResult = { data: 'applied', error: null }
  rpcMock.mockClear()
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

function makeRequest(body: unknown): Request {
  return new Request('https://shop.example/api/posts/boost', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function post(body: unknown) {
  const { POST } = await import('./route')
  // Route is typed for NextRequest but only uses Request-compatible surface.
  return POST(makeRequest(body) as never)
}

describe('boost purchase route', () => {
  it('is inert (404) when the payments add-on is off', async () => {
    process.env = { ...ORIGINAL_ENV, FEATURE_PAYMENTS: 'false' }
    const res = await post({ post_id: POST_ID, idempotency_key: IDEM_KEY })
    expect(res.status).toBe(404)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('requires a session', async () => {
    currentUser = null
    const res = await post({ post_id: POST_ID, idempotency_key: IDEM_KEY })
    expect(res.status).toBe(401)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('rejects malformed bodies before touching the DB', async () => {
    const res = await post({ post_id: 'nope', idempotency_key: IDEM_KEY })
    expect(res.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('prices from the server config and binds the buyer to the session', async () => {
    const res = await post({
      post_id: POST_ID,
      idempotency_key: IDEM_KEY,
      // Body-supplied amounts/users must be ignored by design.
      cost: 1,
      user_id: 'attacker',
    })
    expect(res.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('purchase_post_boost', {
      p_post_id: POST_ID,
      p_user_id: 'user-1',
      p_cost: 20,
      p_duration_days: 7,
      p_idempotency_key: IDEM_KEY,
    })
    const body = await res.json()
    expect(body).toMatchObject({ success: true, already: false, boost_ends_at: '2026-07-13T00:00:00Z' })
  })

  it('maps a replay to success with already=true (charged once)', async () => {
    rpcResult = { data: 'already-applied', error: null }
    const res = await post({ post_id: POST_ID, idempotency_key: IDEM_KEY })
    expect(res.status).toBe(200)
    expect((await res.json()).already).toBe(true)
  })

  it.each([
    ['insufficient-credits', 402],
    ['not-owner', 403],
    ['not-found', 404],
    ['not-published', 409],
    ['something-unexpected', 500],
  ] as const)('maps rpc verdict %s to HTTP %i', async (verdict, status) => {
    rpcResult = { data: verdict, error: null }
    const res = await post({ post_id: POST_ID, idempotency_key: IDEM_KEY })
    expect(res.status).toBe(status)
  })

  it('returns 500 when the rpc itself fails — never fake success', async () => {
    rpcResult = { data: null, error: { message: 'boom' } }
    const res = await post({ post_id: POST_ID, idempotency_key: IDEM_KEY })
    expect(res.status).toBe(500)
  })
})
