// @vitest-environment node
// Validates the require-admin helper end-to-end using the shared supabase
// mock. If these tests regress, every /api/admin/* route's auth could be
// silently broken — this is the most security-sensitive helper in the app.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock } from '../mocks/supabase'

// Stub `@/lib/clients/supabase-admin` so requireAdmin uses the mock instead
// of hitting real Supabase. The mock is defined inside vi.mock callback to
// avoid hoisting issues — we configure its behavior via closure below.
let mockClient = createSupabaseMock({})

vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => mockClient,
}))

// `@supabase/ssr` is imported indirectly — cookie path isn't exercised by
// these tests (we go through the Bearer-token path), so a minimal stub is fine.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    },
  }),
}))

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
}))

// Import AFTER mocks are registered.
const { requireAdmin } = await import('@/lib/clients/require-admin')

/** Builder: NextRequest with a Bearer token + optional body. */
function makeRequest(token?: string): NextRequest {
  const headers = new Headers()
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new NextRequest('https://example.com/api/admin/test', { headers })
}

beforeEach(() => {
  // Reset client state between tests.
  mockClient = createSupabaseMock({})
})

describe('requireAdmin', () => {
  it('rejects unauthenticated requests with 401', async () => {
    mockClient = createSupabaseMock({})
    // Override auth.getUser to simulate "no session". The mock's return
    // type now allows a null user so no cast is needed.
    mockClient.auth.getUser = vi.fn(() => Promise.resolve({ data: { user: null }, error: null }))

    const result = await requireAdmin(makeRequest('bad-token'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
    }
  })

  it('rejects authenticated non-admin users with 403', async () => {
    mockClient = createSupabaseMock({
      profiles: [{ id: 'user-123', is_admin: false }],
    })
    mockClient.auth.getUser = vi.fn(() => Promise.resolve({
      data: { user: { id: 'user-123', email: 'user@example.com' } },
      error: null,
    }))

    const result = await requireAdmin(makeRequest('valid-token-but-not-admin'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(403)
    }
  })

  it('accepts admin users and returns userId', async () => {
    mockClient = createSupabaseMock({
      profiles: [{ id: 'admin-456', is_admin: true }],
    })
    mockClient.auth.getUser = vi.fn(() => Promise.resolve({
      data: { user: { id: 'admin-456', email: 'admin@example.com' } },
      error: null,
    }))

    const result = await requireAdmin(makeRequest('admin-token'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.userId).toBe('admin-456')
    }
  })

  it('rejects when the profiles lookup errors out', async () => {
    mockClient = createSupabaseMock({})
    mockClient.auth.getUser = vi.fn(() => Promise.resolve({
      data: { user: { id: 'admin-456', email: 'x@y.com' } },
      error: null,
    }))
    // Override profiles query to return an error
    mockClient.from = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: { message: 'DB fail' } }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any

    const result = await requireAdmin(makeRequest('token'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // DB errors should also 403 — treating unknown state as "not admin".
      expect(result.response.status).toBe(403)
    }
  })
})
