// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

let gate: { ok: true; userId: string } | { ok: false; response: Response } = { ok: true, userId: 'admin-1' }
vi.mock('@/lib/clients/require-admin', () => ({ requireAdmin: () => Promise.resolve(gate) }))

let reviewResult: unknown = null
const reviewSpy = vi.fn(() => Promise.resolve(reviewResult))
vi.mock('@/lib/performers', () => ({ getPerformerForReview: (...a: unknown[]) => reviewSpy(...(a as [])) }))
vi.mock('@/lib/clients/supabase-admin', () => ({ getSupabaseAdmin: () => ({}) }))

import { NextRequest } from 'next/server'
import { GET } from './route'

const UID = '22222222-2222-2222-2222-222222222222'
function req() {
  return new NextRequest('https://example.com/api/admin/performers/x')
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  gate = { ok: true, userId: 'admin-1' }
  reviewResult = null
})

describe('GET /api/admin/performers/[id]', () => {
  it('propagates the admin gate', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    const res = await GET(req(), ctx(UID))
    expect(res.status).toBe(403)
    expect(reviewSpy).not.toHaveBeenCalled()
  })

  it('400 when the id is not a UUID', async () => {
    const res = await GET(req(), ctx('nope'))
    expect(res.status).toBe(400)
  })

  it('404 when the record is absent', async () => {
    reviewResult = null
    const res = await GET(req(), ctx(UID))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ performer: null })
  })

  it('returns the decrypted record (admin only)', async () => {
    reviewResult = { id: UID, legal_name: 'Ada Lovelace', doc_url: 'https://signed/x', is_complete: false }
    const res = await GET(req(), ctx(UID))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.performer.legal_name).toBe('Ada Lovelace')
    expect(reviewSpy).toHaveBeenCalledWith({}, UID)
  })
})
