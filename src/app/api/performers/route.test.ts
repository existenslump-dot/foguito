// @vitest-environment node
/**
 * Contract tests for the creator-facing 2257 registration route:
 *   - added_by comes from the session, never the request body
 *   - the ID doc is stored under `{uid}/performers/...`
 *   - INVARIANTE #1: this path never certifies (createPerformer can't set
 *     is_complete/dob_verified — enforced by its signature + the guard)
 *   - mime/size validation rejects bad uploads
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

let currentUser: string | null = 'creator-1'
vi.mock('@/lib/clients/require-user', () => ({
  requireUser: () =>
    Promise.resolve(
      currentUser
        ? { ok: true, userId: currentUser }
        : { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) },
    ),
}))

let uploadError: { message: string } | null = null
const uploadSpy = vi.fn((path: string) => Promise.resolve({ data: { path }, error: uploadError }))
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    storage: { from: () => ({ upload: uploadSpy }) },
  }),
}))

let createResult: { ok: true; id: string } | { ok: false; error: string } = { ok: true, id: 'perf-1' }
const createSpy = vi.fn((..._a: unknown[]) => Promise.resolve(createResult))
vi.mock('@/lib/performers', () => ({ createPerformer: (...a: unknown[]) => createSpy(...a) }))

vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn(() => Promise.resolve()) }))

import { POST } from './route'

function jpg(size = 10): File {
  return new File([new Uint8Array(size)], 'dni.jpg', { type: 'image/jpeg' })
}

function makeReq(fields: Record<string, string>, file?: File | null) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  if (file) fd.set('id_doc', file)
  return new Request('https://example.com/api/performers', { method: 'POST', body: fd }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  currentUser = 'creator-1'
  uploadError = null
  createResult = { ok: true, id: 'perf-1' }
})

describe('POST /api/performers', () => {
  it('propagates the user gate (401)', async () => {
    currentUser = null
    const res = await POST(makeReq({ legal_name: 'Ada' }, jpg()))
    expect(res.status).toBe(401)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('400 when legal_name is missing', async () => {
    const res = await POST(makeReq({}, jpg()))
    expect(res.status).toBe(400)
  })

  it('400 when the ID doc is missing', async () => {
    const res = await POST(makeReq({ legal_name: 'Ada' }))
    expect(res.status).toBe(400)
  })

  it('400 on a disallowed mime type', async () => {
    const bad = new File([new Uint8Array(4)], 'x.svg', { type: 'image/svg+xml' })
    const res = await POST(makeReq({ legal_name: 'Ada' }, bad))
    expect(res.status).toBe(400)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('happy path: stores under {uid}/performers/, binds added_by to the session, returns the id', async () => {
    const res = await POST(makeReq({ legal_name: 'Ada Lovelace', added_by: 'ATTACKER', custodian: 'creadora' }, jpg()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'perf-1' })

    // Uploaded under the creator's own uid + performers sub-prefix.
    const uploadedPath = uploadSpy.mock.calls[0][0] as string
    expect(uploadedPath).toMatch(/^creator-1\/performers\/[0-9a-f-]+\/id_doc\.jpg$/)

    // added_by from the session, NOT the body's "ATTACKER".
    // createPerformer(admin, args) → args is the 2nd positional arg.
    const args = createSpy.mock.calls[0][1] as Record<string, unknown>
    expect(args.addedBy).toBe('creator-1')
    expect(args.idDocPath).toBe(uploadedPath)
    expect(args.legalName).toBe('Ada Lovelace')
    // INVARIANTE #1: the caller can't even express certification here.
    expect(args).not.toHaveProperty('isComplete')
    expect(args).not.toHaveProperty('is_complete')
    expect(args).not.toHaveProperty('dob_verified')
  })

  it('500 when the storage upload fails', async () => {
    uploadError = { message: 'bucket down' }
    const res = await POST(makeReq({ legal_name: 'Ada' }, jpg()))
    expect(res.status).toBe(500)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('500 when createPerformer fails', async () => {
    createResult = { ok: false, error: 'db down' }
    const res = await POST(makeReq({ legal_name: 'Ada' }, jpg()))
    expect(res.status).toBe(500)
  })
})
