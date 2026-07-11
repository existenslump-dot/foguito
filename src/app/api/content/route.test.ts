// @vitest-environment node
/**
 * Contract tests for the creator-facing content creation route:
 *   - creator_id comes from the SESSION, never the request body
 *   - 403 when the creator is not verified 18+ (isPublishEligible)
 *   - 409 (fail-closed) when there is no certified self 2257 performer
 *   - happy path uploads under `creator-content/<creatorId>/…`, links the
 *     performer, and returns { id, media_ref }
 *   - INVARIANTE: the route is the only writer — the client never inserts
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextResponse } from 'next/server'
import sharp from 'sharp'

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
const removeSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
const deleteEqSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    storage: { from: () => ({ upload: uploadSpy, remove: removeSpy }) },
    from: () => ({ delete: () => ({ eq: deleteEqSpy }) }),
  }),
}))

let verification: { kyc_status: string; age_verified: boolean } | null = {
  kyc_status: 'verified',
  age_verified: true,
}
vi.mock('@/lib/creators', () => ({
  getCreatorVerification: () => Promise.resolve(verification),
  isPublishEligible: (v: { kyc_status?: string; age_verified?: boolean } | null) =>
    v?.kyc_status === 'verified' && v?.age_verified === true,
}))

let selfPerformerId: string | null = 'perf-self'
let createResult: { ok: true; id: string } | { ok: false; error: string } = { ok: true, id: 'content-1' }
let linkResult: { ok: boolean; error?: string } = { ok: true }
const createSpy = vi.fn((..._a: unknown[]) => Promise.resolve(createResult))
const linkSpy = vi.fn((..._a: unknown[]) => Promise.resolve(linkResult))
vi.mock('@/lib/content', () => ({
  createContentDraft: (...a: unknown[]) => createSpy(...a),
  getSelfPerformerId: () => Promise.resolve(selfPerformerId),
  linkPerformer: (...a: unknown[]) => linkSpy(...a),
}))

vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn(() => Promise.resolve()) }))

import { POST } from './route'

// El alta ahora sniffea magic-bytes + valida decodificabilidad con sharp, así que
// los tests necesitan bytes de imagen REALES (un buffer de ceros ya no pasa).
let realJpeg: Uint8Array<ArrayBuffer>
beforeAll(async () => {
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 20, b: 20 } },
  })
    .jpeg()
    .toBuffer()
  const copy = new Uint8Array(buf.length)
  copy.set(buf)
  realJpeg = copy
})

function jpg(): File {
  return new File([realJpeg], 'foto.jpg', { type: 'image/jpeg' })
}

function makeReq(fields: Record<string, string>, file?: File | null) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  if (file) fd.set('media', file)
  return new Request('https://example.com/api/content', { method: 'POST', body: fd }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  currentUser = 'creator-1'
  uploadError = null
  verification = { kyc_status: 'verified', age_verified: true }
  selfPerformerId = 'perf-self'
  createResult = { ok: true, id: 'content-1' }
  linkResult = { ok: true }
})

describe('POST /api/content', () => {
  it('propagates the user gate (401)', async () => {
    currentUser = null
    const res = await POST(makeReq({ visibility: 'free_preview' }, jpg()))
    expect(res.status).toBe(401)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('403 when the creator is not verified 18+', async () => {
    verification = { kyc_status: 'pending', age_verified: false }
    const res = await POST(makeReq({ visibility: 'free_preview' }, jpg()))
    expect(res.status).toBe(403)
    expect(uploadSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('400 on an invalid visibility', async () => {
    const res = await POST(makeReq({ visibility: 'public' }, jpg()))
    expect(res.status).toBe(400)
  })

  it('400 when visibility=tier without a valid required_tier', async () => {
    const res = await POST(makeReq({ visibility: 'tier', required_tier: 'platinum' }, jpg()))
    expect(res.status).toBe(400)
  })

  it('400 when visibility=ppv without a positive price', async () => {
    const res = await POST(makeReq({ visibility: 'ppv', ppv_price_credits: '0' }, jpg()))
    expect(res.status).toBe(400)
  })

  it('400 on a disallowed media mime', async () => {
    const bad = new File([new Uint8Array(4)], 'x.svg', { type: 'image/svg+xml' })
    const res = await POST(makeReq({ visibility: 'free_preview' }, bad))
    expect(res.status).toBe(400)
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  it('400 when the declared type does not match the actual bytes (watermark-strip bypass blocked)', async () => {
    // Bytes de imagen REAL declarados como video/mp4: sin el sniff se guardaría
    // media_type='video' y se serviría sin marca de agua. El sniff lo rechaza.
    const mislabeled = new File([realJpeg], 'clip.mp4', { type: 'video/mp4' })
    const res = await POST(makeReq({ visibility: 'free_preview' }, mislabeled))
    expect(res.status).toBe(400)
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  it('400 when the bytes carry an image signature but sharp cannot decode them', async () => {
    // FF D8 FF (firma JPEG) pero no es un JPEG válido → sniff 'image' matchea, pero
    // sharp.metadata() tira → se rechaza en el alta (evita el 404 eterno en entrega).
    const corrupt = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22])], 'foto.jpg', {
      type: 'image/jpeg',
    })
    const res = await POST(makeReq({ visibility: 'free_preview' }, corrupt))
    expect(res.status).toBe(400)
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  it('409 (fail-closed) when there is no certified self 2257 performer', async () => {
    selfPerformerId = null
    const res = await POST(makeReq({ visibility: 'free_preview' }, jpg()))
    expect(res.status).toBe(409)
    // fail-closed BEFORE the upload — no orphan media
    expect(uploadSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('happy path: uploads under creator-content/<creatorId>/, links the performer, returns id + media_ref', async () => {
    const res = await POST(
      makeReq({ visibility: 'tier', required_tier: 'gold', creator_id: 'ATTACKER', title: 'hola' }, jpg()),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('content-1')
    expect(body.media_ref).toMatch(/^creator-1\/[0-9a-f-]+\/media\.jpg$/)

    // uploaded under the SESSION creator's prefix, not the body's "ATTACKER"
    const uploadedPath = uploadSpy.mock.calls[0][0] as string
    expect(uploadedPath).toMatch(/^creator-1\//)

    // createContentDraft(admin, args) → creator_id bound to the session
    const args = createSpy.mock.calls[0][1] as Record<string, unknown>
    expect(args.creatorId).toBe('creator-1')
    expect(args.mediaRef).toBe(uploadedPath)
    expect(args.visibility).toBe('tier')
    expect(args.requiredTier).toBe('gold')

    // linked to the creator's self performer
    expect(linkSpy).toHaveBeenCalledWith(expect.anything(), 'content-1', 'perf-self')
  })

  it('rolls back the uploaded media when the draft insert fails', async () => {
    createResult = { ok: false, error: 'db down' }
    const res = await POST(makeReq({ visibility: 'free_preview' }, jpg()))
    expect(res.status).toBe(500)
    expect(removeSpy).toHaveBeenCalledTimes(1)
  })

  it('rolls back media + draft when linking the performer fails', async () => {
    linkResult = { ok: false, error: 'fk' }
    const res = await POST(makeReq({ visibility: 'free_preview' }, jpg()))
    expect(res.status).toBe(500)
    expect(deleteEqSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledTimes(1)
  })

  it('500 when the storage upload fails', async () => {
    uploadError = { message: 'bucket down' }
    const res = await POST(makeReq({ visibility: 'free_preview' }, jpg()))
    expect(res.status).toBe(500)
    expect(createSpy).not.toHaveBeenCalled()
  })
})
