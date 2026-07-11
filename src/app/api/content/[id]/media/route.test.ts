// @vitest-environment node
/**
 * Contract tests for the paid-fan content DELIVERY route (PR-5).
 *
 * Fail-closed order asserted end to end:
 *   403  → cross-origin request (isSameOrigin false)
 *   401  → no session (fan client's auth.getUser → null)
 *   403  → age-gate fails (gated jurisdiction, no valid verification)
 *   429  → rate-limit miss
 *   404  → getContentForDelivery → null (not-entitled / blocked / missing: no oracle)
 *   200  → image path streams WATERMARKED bytes + Cache-Control: private, no-store + audit
 *   302  → video path redirects to the 60s signed URL + audit
 *
 * Blocked/unscanned content never reaches signing — covered because
 * getContentForDelivery returns null for it (asserted in content.test.ts) and
 * here we assert storage is never touched when the row is null.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const VALID_ID = '11111111-1111-1111-1111-111111111111'

// ── same-origin guard ───────────────────────────────────────────────
let sameOrigin = true
vi.mock('@/lib/clients/same-origin', () => ({
  isSameOrigin: (..._a: unknown[]) => sameOrigin,
}))

// ── fan RLS client: el cookie-scoped createServerClient. Su auth.getUser() es a
//    la vez la fuente de la sesión (fanId) y el cliente RLS que aplica el paywall,
//    así la identidad del acceso == la de la marca de agua + auditoría ──
let currentUser: string | null = 'fan-1'
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ getAll: () => [] }) }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: currentUser ? { id: currentUser } : null } }),
    },
  }),
}))

// ── age-gate: keep viewer-geo + jurisdictions REAL (headers drive them),
//    mock only the server-authoritative verification lookup ──
let ageOk = true
vi.mock('@/lib/age-gate/status', () => ({
  hasValidVerification: (..._a: unknown[]) => Promise.resolve(ageOk),
}))

// ── rate limit ──────────────────────────────────────────────────────
let rlResult: { success: boolean; retryAfter: number } = { success: true, retryAfter: 0 }
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: (..._a: unknown[]) => Promise.resolve(rlResult),
}))

// ── entitlement/delivery resolution ─────────────────────────────────
type Row = { id: string; creator_id: string; media_ref: string; media_type: string; visibility: string } | null
let deliveryRow: Row = {
  id: VALID_ID, creator_id: 'creator-1', media_ref: 'creator-1/x/media.jpg',
  media_type: 'image', visibility: 'free_preview',
}
vi.mock('@/lib/content', () => ({
  getContentForDelivery: (..._a: unknown[]) => Promise.resolve(deliveryRow),
}))

// ── service-role storage ────────────────────────────────────────────
let downloadResult: { data: Blob | null; error: { message: string } | null } = {
  data: new Blob([new Uint8Array([1, 2, 3, 4])]),
  error: null,
}
let signResult: { data: { signedUrl: string } | null; error: { message: string } | null } = {
  data: { signedUrl: 'https://signed.example/v?token=abc' },
  error: null,
}
const downloadSpy = vi.fn((..._a: unknown[]) => Promise.resolve(downloadResult))
const signSpy = vi.fn((..._a: unknown[]) => Promise.resolve(signResult))
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    storage: { from: () => ({ download: downloadSpy, createSignedUrl: signSpy }) },
  }),
}))

// ── watermark (real sharp is exercised in content-watermark.server.test.ts) ──
const watermarkSpy = vi.fn((..._a: unknown[]) =>
  Promise.resolve({ data: Buffer.from('WATERMARKED'), contentType: 'image/png' }),
)
vi.mock('@/lib/content-watermark.server', () => ({
  watermarkImageBuffer: (...a: unknown[]) => watermarkSpy(...a),
  buildFanLabel: (fanId: string, contentId: string) => `${fanId}:${contentId}`,
}))

// ── audit ───────────────────────────────────────────────────────────
const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...a) }))

import { GET } from './route'

// A gated jurisdiction (BR → verify_required) so requirement !== 'none' and the
// age-gate is actually exercised.
function makeReq(country = 'BR') {
  return new Request(`https://example.com/api/content/${VALID_ID}/media`, {
    headers: { 'x-vercel-ip-country': country },
  }) as never
}
const ctx = { params: Promise.resolve({ id: VALID_ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  sameOrigin = true
  currentUser = 'fan-1'
  ageOk = true
  rlResult = { success: true, retryAfter: 0 }
  deliveryRow = {
    id: VALID_ID, creator_id: 'creator-1', media_ref: 'creator-1/x/media.jpg',
    media_type: 'image', visibility: 'free_preview',
  }
  downloadResult = { data: new Blob([new Uint8Array([1, 2, 3, 4])]), error: null }
  signResult = { data: { signedUrl: 'https://signed.example/v?token=abc' }, error: null }
})

describe('GET /api/content/[id]/media', () => {
  it('403 when the request is cross-origin (never touches storage)', async () => {
    sameOrigin = false
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('invalid origin')
    expect(downloadSpy).not.toHaveBeenCalled()
    expect(signSpy).not.toHaveBeenCalled()
  })

  it('401 when there is no session (never touches storage)', async () => {
    currentUser = null
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(401)
    expect(downloadSpy).not.toHaveBeenCalled()
    expect(signSpy).not.toHaveBeenCalled()
  })

  it('403 when the age-gate fails in a gated jurisdiction', async () => {
    ageOk = false
    const res = await GET(makeReq('BR'), ctx)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('age verification required')
    expect(downloadSpy).not.toHaveBeenCalled()
  })

  it('429 on a rate-limit miss with Retry-After', async () => {
    rlResult = { success: false, retryAfter: 42 }
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('42')
    expect(downloadSpy).not.toHaveBeenCalled()
  })

  it('404 when getContentForDelivery returns null (no oracle, no signing)', async () => {
    deliveryRow = null
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(404)
    expect(downloadSpy).not.toHaveBeenCalled()
    expect(signSpy).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('image → 200 watermarked bytes, private no-store, audits the delivery', async () => {
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('content-disposition')).toBe('inline')

    const body = Buffer.from(await res.arrayBuffer())
    expect(body.toString()).toBe('WATERMARKED')

    // signed URL never minted on the image path
    expect(signSpy).not.toHaveBeenCalled()
    expect(watermarkSpy).toHaveBeenCalledTimes(1)

    expect(auditSpy).toHaveBeenCalledTimes(1)
    const auditArg = auditSpy.mock.calls[0][0] as Record<string, unknown>
    expect(auditArg.eventType).toBe('content_delivered')
    expect(auditArg.actorUserId).toBe('fan-1')
    expect(auditArg.subjectId).toBe(VALID_ID)
  })

  it('image → 404 (fail-closed) when the storage download errors', async () => {
    downloadResult = { data: null, error: { message: 'gone' } }
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(404)
    expect(watermarkSpy).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('video → 302 redirect to the 60s signed URL, audits the delivery', async () => {
    deliveryRow = {
      id: VALID_ID, creator_id: 'creator-1', media_ref: 'creator-1/x/clip.mp4',
      media_type: 'video', visibility: 'tier',
    }
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://signed.example/v?token=abc')
    expect(res.headers.get('cache-control')).toBe('private, no-store')

    // 60s TTL passed to the signer; image path not taken
    expect(signSpy).toHaveBeenCalledTimes(1)
    expect(signSpy.mock.calls[0][1]).toBe(60)
    expect(downloadSpy).not.toHaveBeenCalled()
    expect(watermarkSpy).not.toHaveBeenCalled()

    expect(auditSpy).toHaveBeenCalledTimes(1)
  })

  it('video → 404 (fail-closed) when signing fails', async () => {
    deliveryRow = {
      id: VALID_ID, creator_id: 'creator-1', media_ref: 'creator-1/x/clip.mp4',
      media_type: 'video', visibility: 'tier',
    }
    signResult = { data: null, error: { message: 'nope' } }
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(404)
    expect(auditSpy).not.toHaveBeenCalled()
  })
})
