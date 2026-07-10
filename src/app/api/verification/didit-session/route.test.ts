// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────
let enabled = true
let createResult: { ok: boolean; data?: { session_id: string; url: string }; error?: string } = {
  ok: true,
  data: { session_id: 'sess-1', url: 'https://verify.didit.me/session/abc' },
}
let userGate: { ok: true; userId: string } | { ok: false; response: Response } = {
  ok: true,
  userId: 'user-1',
}
let insertError: { message: string } | null = null
const inserted: unknown[] = []

vi.mock('@/lib/didit/config', () => ({
  isDiditEnabled: () => enabled,
  diditWorkflowId: () => 'wf-1',
}))
vi.mock('@/lib/didit/client', () => ({
  createSession: () => Promise.resolve(createResult),
}))
vi.mock('@/lib/clients/require-user', () => ({
  requireUser: () => Promise.resolve(userGate),
}))
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      insert: (row: unknown) => {
        inserted.push(row)
        return Promise.resolve({ error: insertError })
      },
    }),
  }),
}))
vi.mock('@/lib/audit', () => ({ recordAudit: () => Promise.resolve() }))

import { GET, POST } from './route'

function postReq() {
  return new Request('https://example.com/api/verification/didit-session', {
    method: 'POST',
  }) as unknown as import('next/server').NextRequest
}

describe('GET /api/verification/didit-session', () => {
  it('reports enabled', async () => {
    enabled = true
    const res = await GET()
    expect(await res.json()).toEqual({ enabled: true })
    enabled = false
    expect(await (await GET()).json()).toEqual({ enabled: false })
  })
})

describe('POST /api/verification/didit-session', () => {
  beforeEach(() => {
    enabled = true
    createResult = { ok: true, data: { session_id: 'sess-1', url: 'https://verify.didit.me/session/abc' } }
    userGate = { ok: true, userId: 'user-1' }
    insertError = null
    inserted.length = 0
  })

  it('503 if Didit is disabled', async () => {
    enabled = false
    const res = await POST(postReq())
    expect(res.status).toBe(503)
  })

  it('creates a session, persists the row and returns the url', async () => {
    const res = await POST(postReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://verify.didit.me/session/abc' })
    expect(inserted).toHaveLength(1)
    const row = inserted[0] as Record<string, unknown>
    expect(row.user_id).toBe('user-1')
    expect(row.didit_session_id).toBe('sess-1')
    expect(row.status).toBe('created')
  })

  it('propagates the auth gate (401)', async () => {
    userGate = { ok: false, response: new Response(null, { status: 401 }) }
    const res = await POST(postReq())
    expect(res.status).toBe(401)
    expect(inserted).toHaveLength(0)
  })

  it('502 if createSession fails', async () => {
    createResult = { ok: false, error: 'boom' }
    const res = await POST(postReq())
    expect(res.status).toBe(502)
    expect(inserted).toHaveLength(0)
  })

  it('still returns the url if the insert fails (best-effort)', async () => {
    insertError = { message: 'db down' }
    const res = await POST(postReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://verify.didit.me/session/abc' })
  })
})
