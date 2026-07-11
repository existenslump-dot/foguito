// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

let gate: { ok: true; userId: string } | { ok: false; response: Response } = { ok: true, userId: 'admin-1' }
vi.mock('@/lib/clients/require-admin', () => ({ requireAdmin: () => Promise.resolve(gate) }))

let listResult: { ok: true; performers: unknown[] } | { ok: false; error: string } = { ok: true, performers: [] }
const listSpy = vi.fn(() => Promise.resolve(listResult))
vi.mock('@/lib/performers', () => ({ listIncompletePerformers: (...a: unknown[]) => listSpy(...(a as [])) }))
vi.mock('@/lib/clients/supabase-admin', () => ({ getSupabaseAdmin: () => ({}) }))

import { NextRequest } from 'next/server'
import { GET } from './route'

function req() {
  return new NextRequest('https://example.com/api/admin/performers?complete=false')
}

beforeEach(() => {
  vi.clearAllMocks()
  gate = { ok: true, userId: 'admin-1' }
  listResult = { ok: true, performers: [] }
})

describe('GET /api/admin/performers', () => {
  it('propagates the admin gate', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(listSpy).not.toHaveBeenCalled()
  })

  it('returns the incomplete queue (safe summaries, no legal name)', async () => {
    listResult = {
      ok: true,
      performers: [{ id: 'p1', added_by: 'c1', custodian: null, is_self: false, is_complete: false, dob_verified: false, created_at: 'x' }],
    }
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.performers).toHaveLength(1)
    // the summary must not carry decrypted PII
    expect(body.performers[0]).not.toHaveProperty('legal_name')
    expect(body.performers[0]).not.toHaveProperty('legal_name_enc')
  })

  it('500 on a DB error', async () => {
    listResult = { ok: false, error: 'db down' }
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
