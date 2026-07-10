// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

let gate: { ok: true; userId: string } | { ok: false; response: Response } = { ok: true, userId: 'admin-1' }
let row: Record<string, unknown> | null = null
let selectError: { message: string } | null = null
let decryptResult: unknown = { decision: { id_verification: { first_name: 'Ana', last_name: 'P', document_number: '123' } } }
let decryptThrows = false

vi.mock('@/lib/clients/require-admin', () => ({
  requireAdmin: () => Promise.resolve(gate),
}))
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: row, error: selectError }),
            }),
          }),
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/didit/crypto', () => ({
  decryptJson: () => {
    if (decryptThrows) throw new Error('bad key')
    return decryptResult
  },
}))

import { NextRequest } from 'next/server'
import { GET } from './route'

const UID = '11111111-1111-1111-1111-111111111111'

function req(userId: string) {
  return new NextRequest(`https://example.com/api/admin/verification-session?userId=${userId}`)
}

describe('GET /api/admin/verification-session', () => {
  beforeEach(() => {
    gate = { ok: true, userId: 'admin-1' }
    row = null
    selectError = null
    decryptThrows = false
    decryptResult = { decision: { id_verification: { first_name: 'Ana', last_name: 'P', document_number: '123' } } }
  })

  it('propagates the admin gate', async () => {
    gate = { ok: false, response: new Response(null, { status: 403 }) }
    const res = await GET(req(UID))
    expect(res.status).toBe(403)
  })

  it('400 if userId is not a UUID', async () => {
    const res = await GET(req('nope'))
    expect(res.status).toBe(400)
  })

  it('session null if there is no row', async () => {
    row = null
    const res = await GET(req(UID))
    expect(await res.json()).toEqual({ session: null })
  })

  it('returns metadata + decrypted data, without the encrypted blob', async () => {
    row = {
      didit_session_id: 's1',
      status: 'approved',
      decision: 'Approved',
      decline_reason: null,
      face_match_score: 97,
      liveness_score: 92,
      decision_payload_encrypted: 'v1.aa.bb.cc',
      last_webhook_at: '2026-06-23T00:00:00Z',
      created_at: '2026-06-23T00:00:00Z',
    }
    const res = await GET(req(UID))
    const body = await res.json()
    expect(body.session.status).toBe('approved')
    expect(body.session.face_match_score).toBe(97)
    expect(body.session.id_verification).toEqual({ first_name: 'Ana', last_name: 'P', document_number: '123' })
    // never expose the blob
    expect(body.session.decision_payload_encrypted).toBeUndefined()
  })

  it('if decryption fails, returns metadata without id_verification', async () => {
    decryptThrows = true
    row = {
      didit_session_id: 's1', status: 'in_review', decision: 'In Review', decline_reason: null,
      face_match_score: 40, liveness_score: 88, decision_payload_encrypted: 'v1.aa.bb.cc',
      last_webhook_at: null, created_at: '2026-06-23T00:00:00Z',
    }
    const res = await GET(req(UID))
    const body = await res.json()
    expect(body.session.status).toBe('in_review')
    expect(body.session.id_verification).toBeNull()
  })

  it('500 if the select fails', async () => {
    selectError = { message: 'db down' }
    const res = await GET(req(UID))
    expect(res.status).toBe(500)
  })
})
