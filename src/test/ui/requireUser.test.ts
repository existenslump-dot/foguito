// @vitest-environment node
// Mirrors require-admin tests — validates the require-user helper end-to-end.
// Every mutation route that stopped accepting client-supplied user_id now
// leans on this helper; if it regresses, favorites/push/reviews become
// impersonation-friendly again.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createSupabaseMock } from '../mocks/supabase'

let mockClient = createSupabaseMock({})
let cookieUser: { id: string; email: string } | null = null

vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => mockClient,
}))

// Cookie path — exposed so tests can flip it between "no cookie session"
// and "cookie session present" to cover both resolution branches.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: () => Promise.resolve({
        data: { user: cookieUser },
        error: null,
      }),
    },
  }),
}))

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
}))

const { requireUser, getOptionalUser } = await import('@/lib/clients/require-user')

function makeRequest(token?: string): NextRequest {
  const headers = new Headers()
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new NextRequest('https://example.com/api/test', { headers })
}

beforeEach(() => {
  mockClient = createSupabaseMock({})
  cookieUser = null
})

describe('requireUser', () => {
  it('accepts a valid Bearer token and returns userId', async () => {
    mockClient.auth.getUser = vi.fn(() => Promise.resolve({
      data: { user: { id: 'user-123', email: 'u@x.com' } },
      error: null,
    }))

    const result = await requireUser(makeRequest('valid-bearer'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.userId).toBe('user-123')
  })

  it('falls back to cookie session when no Bearer is present', async () => {
    cookieUser = { id: 'cookie-user-999', email: 'c@x.com' }

    const result = await requireUser(makeRequest())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.userId).toBe('cookie-user-999')
  })

  it('returns 401 when Bearer token is invalid AND no cookie session', async () => {
    mockClient.auth.getUser = vi.fn(() => Promise.resolve({
      data: { user: null },
      error: null,
    }))
    cookieUser = null

    const result = await requireUser(makeRequest('bad-token'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })

  it('returns 401 for fully anonymous requests', async () => {
    mockClient.auth.getUser = vi.fn(() => Promise.resolve({
      data: { user: null },
      error: null,
    }))
    cookieUser = null

    const result = await requireUser(makeRequest())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })

  it('prefers Bearer over cookie when both are valid', async () => {
    // Bearer points at user-A, cookie at user-B — we should see user-A.
    // Ensures the resolve order is stable; if someone accidentally flips
    // it, routes could bind writes to the wrong identity.
    mockClient.auth.getUser = vi.fn(() => Promise.resolve({
      data: { user: { id: 'bearer-user', email: 'a@x.com' } },
      error: null,
    }))
    cookieUser = { id: 'cookie-user', email: 'b@x.com' }

    const result = await requireUser(makeRequest('bearer-token'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.userId).toBe('bearer-user')
  })
})

describe('getOptionalUser', () => {
  it('returns the userId when a Bearer token resolves', async () => {
    mockClient.auth.getUser = vi.fn(() => Promise.resolve({
      data: { user: { id: 'anon-1', email: 'x@y.com' } },
      error: null,
    }))

    const result = await getOptionalUser(makeRequest('token'))
    expect(result).toBe('anon-1')
  })

  it('returns null when no session is found (no 401 response)', async () => {
    mockClient.auth.getUser = vi.fn(() => Promise.resolve({
      data: { user: null },
      error: null,
    }))
    cookieUser = null

    const result = await getOptionalUser(makeRequest())
    // This is the key difference vs requireUser — anonymous callers must
    // see `null`, not a 401 NextResponse, so routes like /api/reviews can
    // still accept them.
    expect(result).toBeNull()
  })
})
