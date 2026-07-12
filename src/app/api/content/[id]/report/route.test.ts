// @vitest-environment node
/**
 * Contract tests del intake de quejas de contenido (PR-9).
 *
 *   403 cross-origin (nunca inserta) · 400 UUID inválido / categoría inválida
 *   429 rate-limit por-IP y por-contenido · happy path inserta con sla escalonado
 *   + audita · 200 genérica sin oráculo (contenido inexistente / dedup)
 *   · anon permitido · reporter id/ip SIEMPRE del server, nunca del body
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const VALID_ID = '11111111-1111-1111-1111-111111111111'
const SERVER_IP = '9.9.9.9'

// ── same-origin ──────────────────────────────────────────────────────
let sameOrigin = true
vi.mock('@/lib/clients/same-origin', () => ({
  isSameOrigin: (..._a: unknown[]) => sameOrigin,
}))

// ── optional user (anon permitido) ───────────────────────────────────
let optionalUser: string | null = 'user-1'
vi.mock('@/lib/clients/require-user', () => ({
  getOptionalUser: (..._a: unknown[]) => Promise.resolve(optionalUser),
}))

// ── rate-limit: cola de resultados (1ª = por-IP, 2ª = por-contenido) ──
let rlResults: Array<{ success: boolean; retryAfter: number }> = []
const rlSpy = vi.fn((..._a: unknown[]) =>
  Promise.resolve(rlResults.shift() ?? { success: true, retryAfter: 0 }),
)
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: (...a: unknown[]) => rlSpy(...a),
}))

// ── audit ────────────────────────────────────────────────────────────
const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...a) }))

// ── service-role admin fake ──────────────────────────────────────────
type Call = { table: string; op: string; payload: unknown }
let calls: Call[] = []
let dedupRow: unknown = null
let contentRow: unknown = { creator_id: 'creator-1' }
let insertError: { message: string } | null = null

function makeBuilder(table: string) {
  let op = 'select'
  let payload: unknown = null
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    insert: vi.fn((p: unknown) => { op = 'insert'; payload = p; return builder }),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => {
      calls.push({ table, op, payload })
      const data = table === 'content' ? contentRow : dedupRow
      return Promise.resolve({ data, error: null })
    }),
    then: (resolve: (v: unknown) => unknown) => {
      calls.push({ table, op, payload })
      return resolve({ data: null, error: op === 'insert' ? insertError : null })
    },
  }
  return builder
}
const admin = { from: vi.fn((t: string) => makeBuilder(t)) }
vi.mock('@/lib/clients/supabase-admin', () => ({ getSupabaseAdmin: () => admin }))

import { POST } from './route'

function makeReq(body: unknown) {
  return new Request(`https://example.com/api/content/${VALID_ID}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': SERVER_IP },
    body: JSON.stringify(body),
  })
}
const ctx = (id = VALID_ID) => ({ params: Promise.resolve({ id }) })
const insertCall = () => calls.find((c) => c.op === 'insert')

beforeEach(() => {
  vi.clearAllMocks()
  sameOrigin = true
  optionalUser = 'user-1'
  rlResults = []
  calls = []
  dedupRow = null
  contentRow = { creator_id: 'creator-1' }
  insertError = null
})

describe('POST /api/content/[id]/report', () => {
  it('403 cross-origin — nunca inserta', async () => {
    sameOrigin = false
    const res = await POST(makeReq({ category: 'spam' }), ctx())
    expect(res.status).toBe(403)
    expect(insertCall()).toBeUndefined()
    expect(rlSpy).not.toHaveBeenCalled()
  })

  it('400 con id no-UUID', async () => {
    const res = await POST(makeReq({ category: 'spam' }), ctx('not-a-uuid'))
    expect(res.status).toBe(400)
    expect(insertCall()).toBeUndefined()
  })

  it('400 con categoría inválida', async () => {
    const res = await POST(makeReq({ category: 'nope' }), ctx())
    expect(res.status).toBe(400)
    expect(insertCall()).toBeUndefined()
  })

  it('429 por rate-limit por-IP (nunca inserta)', async () => {
    rlResults = [{ success: false, retryAfter: 30 }]
    const res = await POST(makeReq({ category: 'spam' }), ctx())
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('30')
    expect(insertCall()).toBeUndefined()
  })

  it('429 por rate-limit por-reporter-por-pieza (pasa el por-IP, cae el 2º)', async () => {
    rlResults = [{ success: true, retryAfter: 0 }, { success: false, retryAfter: 60 }]
    const res = await POST(makeReq({ category: 'spam' }), ctx())
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
    expect(insertCall()).toBeUndefined()
    // Corta en el 2º (no consulta el global). El 1º es por-IP; el 2º por-reporter
    // (identidad de sesión `u:user-1`, no la IP) por-pieza.
    expect(rlSpy).toHaveBeenCalledTimes(2)
    expect(rlSpy.mock.calls[0][0]).toBe(`content-report:${SERVER_IP}`)
    expect(rlSpy.mock.calls[1][0]).toBe(`content-report:u:user-1:${VALID_ID}`)
  })

  it('429 por cap global-por-pieza (pasan por-IP y por-reporter, cae el 3º)', async () => {
    rlResults = [
      { success: true, retryAfter: 0 },
      { success: true, retryAfter: 0 },
      { success: false, retryAfter: 90 },
    ]
    const res = await POST(makeReq({ category: 'spam' }), ctx())
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('90')
    expect(insertCall()).toBeUndefined()
    expect(rlSpy).toHaveBeenCalledTimes(3)
    // El 3º es un cap global por-pieza (no depende de la IP ni del reporter) → acota
    // un flood por IP rotada a UNA pieza.
    expect(rlSpy.mock.calls[2][0]).toBe(`content-report:global:${VALID_ID}`)
  })

  it('anon: la key por-reporter cae a IP (no hay identidad de sesión)', async () => {
    optionalUser = null
    rlResults = [{ success: true, retryAfter: 0 }, { success: false, retryAfter: 60 }]
    const res = await POST(makeReq({ category: 'spam' }), ctx())
    expect(res.status).toBe(429)
    expect(rlSpy.mock.calls[1][0]).toBe(`content-report:ip:${SERVER_IP}:${VALID_ID}`)
  })

  it('happy path: inserta con sla escalonado + audita + 200 genérica', async () => {
    const before = Date.now()
    const res = await POST(makeReq({ category: 'illegal', description: 'esto es ilegal' }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const p = insertCall()!.payload as Record<string, unknown>
    expect(p.content_id).toBe(VALID_ID)
    expect(p.creator_id).toBe('creator-1')
    expect(p.reporter_user_id).toBe('user-1')
    expect(p.reporter_ip).toBe(SERVER_IP)
    expect(p.category).toBe('illegal')
    expect(p.description).toBe('esto es ilegal')
    // illegal → SLA 24h.
    const due = Date.parse(p.sla_due_at as string) - before
    expect(due).toBeGreaterThan(23.5 * 60 * 60 * 1000)
    expect(due).toBeLessThan(24.5 * 60 * 60 * 1000)

    expect(auditSpy).toHaveBeenCalledTimes(1)
    const a = auditSpy.mock.calls[0][0] as Record<string, unknown>
    expect(a.eventType).toBe('complaint_received')
    expect(a.actorRole).toBe('user')
    expect(a.subjectId).toBe(VALID_ID)
  })

  it('dmca → SLA 72h', async () => {
    const before = Date.now()
    await POST(makeReq({ category: 'dmca' }), ctx())
    const p = insertCall()!.payload as Record<string, unknown>
    const due = Date.parse(p.sla_due_at as string) - before
    expect(due).toBeGreaterThan(71.5 * 60 * 60 * 1000)
    expect(due).toBeLessThan(72.5 * 60 * 60 * 1000)
  })

  it('sin oráculo: contenido inexistente → 200 genérica y NO inserta', async () => {
    contentRow = null
    const res = await POST(makeReq({ category: 'spam' }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(insertCall()).toBeUndefined()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('dedup: queja open existente → 200 genérica y NO inserta', async () => {
    dedupRow = { id: 'existing' }
    const res = await POST(makeReq({ category: 'spam' }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(insertCall()).toBeUndefined()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('anon permitido: sin sesión → inserta con reporter null + audit anonymous', async () => {
    optionalUser = null
    const res = await POST(makeReq({ category: 'other' }), ctx())
    expect(res.status).toBe(200)
    const p = insertCall()!.payload as Record<string, unknown>
    expect(p.reporter_user_id).toBeNull()
    const a = auditSpy.mock.calls[0][0] as Record<string, unknown>
    expect(a.actorRole).toBe('anonymous')
    expect(a.actorUserId).toBeNull()
  })

  it('reporter id/ip SIEMPRE del server, jamás del body', async () => {
    // El atacante intenta inyectar otro reporter + una IP falsa.
    await POST(
      makeReq({
        category: 'spam',
        reporter_user_id: 'attacker',
        reporter_ip: '1.1.1.1',
        content_id: 'otro-contenido',
      }),
      ctx(),
    )
    const p = insertCall()!.payload as Record<string, unknown>
    expect(p.reporter_user_id).toBe('user-1') // de la sesión
    expect(p.reporter_ip).toBe(SERVER_IP)      // de los headers
    expect(p.content_id).toBe(VALID_ID)        // del path param
    expect(p.reporter_user_id).not.toBe('attacker')
    expect(p.reporter_ip).not.toBe('1.1.1.1')
  })

  it('error de insert → MISMA 200 genérica (sin oráculo de existencia)', async () => {
    // Un fallo de insert sólo pasa para contenido existente; un 500 acá lo delataría.
    // Debe verse idéntico al camino "no existe" / dedup: 200 {ok:true}, sin audit.
    insertError = { message: 'db down' }
    const res = await POST(makeReq({ category: 'spam' }), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(JSON.stringify(body)).not.toContain('db down')
    expect(auditSpy).not.toHaveBeenCalled()
  })
})
