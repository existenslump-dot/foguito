// @vitest-environment node
/**
 * Contract tests del cron de re-screening AML (PR-10).
 *
 *   CRON_SECRET fail-closed (unset → 500; bad bearer → 401) · re-screenea creadoras
 *   + consumidores pagadores vía screenSubject · cuenta hits/reviews · un throw por
 *   sujeto NO aborta el batch (se cuenta como failure) · audita aml_rescreen_run ·
 *   el cutoff de frescura se computa en JS y se pasa al filtro (.or/.lt).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const SECRET = 'cron_secret_test'

// ── service-role: from() chains thenable + rpc() ─────────────────────
let creatorsRows: Array<Record<string, unknown>> = []
let consumerRows: Array<Record<string, unknown>> = []
const orFilters: string[] = []
let rpcCalls: Array<{ name: string; params: unknown }> = []

function makeQuery(result: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'neq', 'order', 'limit', 'in', 'eq']) {
    q[m] = vi.fn(() => q)
  }
  q.or = vi.fn((f: string) => {
    orFilters.push(f)
    return q
  })
  q.then = (resolve: (v: unknown) => void) => resolve(result)
  return q
}
const fromSpy = vi.fn((table: string) => {
  if (table === 'creators') return makeQuery({ data: creatorsRows, error: null })
  return makeQuery({ data: [], error: null })
})
// Los consumidores pagadores vienen de la RPC (distinct+order+limit en la DB).
const rpcSpy = vi.fn((name: string, params: unknown) => {
  rpcCalls.push({ name, params })
  if (name === 'stale_consumer_payers') return Promise.resolve({ data: consumerRows, error: null })
  return Promise.resolve({ data: [], error: null })
})
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: fromSpy, rpc: rpcSpy }),
}))

// ── motor AML ────────────────────────────────────────────────────────
let hitIds = new Set<string>()
let throwIds = new Set<string>()
const screenSpy = vi.fn((_admin: unknown, args: { subjectType: string; subjectId: string }) => {
  if (throwIds.has(args.subjectId)) return Promise.reject(new Error('screen boom'))
  const status = hitIds.has(args.subjectId) ? 'hit' : 'clear'
  return Promise.resolve({ status, ref: 'R', provider: 'stub' })
})
vi.mock('@/lib/aml', () => ({
  screenSubject: (...a: unknown[]) => screenSpy(...(a as [unknown, { subjectType: string; subjectId: string }])),
}))

const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...a) }))

import { GET } from './route'

function req(auth?: string) {
  return new Request('https://example.com/api/cron/aml-rescreen', {
    headers: auth ? { authorization: auth } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  creatorsRows = []
  consumerRows = []
  orFilters.length = 0
  rpcCalls = []
  hitIds = new Set()
  throwIds = new Set()
  delete process.env.AML_RESCREEN_DAYS
})
afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.AML_RESCREEN_DAYS
})

describe('GET /api/cron/aml-rescreen', () => {
  it('CRON_SECRET no configurado → 500 (fail-closed)', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(500)
    expect(screenSpy).not.toHaveBeenCalled()
  })

  it('bearer incorrecto → 401', async () => {
    const res = await GET(req('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(screenSpy).not.toHaveBeenCalled()
  })

  it('sin sujetos → 200, no screenea, audita el run con ceros', async () => {
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    expect(screenSpy).not.toHaveBeenCalled()
    expect(auditSpy).toHaveBeenCalledTimes(1)
    expect(auditSpy.mock.calls[0][0]).toMatchObject({
      eventType: 'aml_rescreen_run',
      actorRole: 'system',
      metadata: { creators_screened: 0, consumers_screened: 0, hits: 0, reviews: 0 },
    })
  })

  it('re-screenea creadoras + consumidores pagadores; cuenta hits', async () => {
    creatorsRows = [
      { user_id: 'creator-1', pseudonym: 'Ada', country: 'AR', sanctions_screened_at: null },
      { user_id: 'creator-2', pseudonym: 'Bea', country: 'CL', sanctions_screened_at: null },
    ]
    consumerRows = [{ id: 'fan-1', consumer_screened_at: null }, { id: 'fan-2', consumer_screened_at: null }]
    hitIds = new Set(['creator-2'])

    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    // 2 creadoras + 2 consumidores.
    expect(screenSpy).toHaveBeenCalledTimes(4)
    // Se pasó la superficie correcta a cada uno.
    const surfaces = screenSpy.mock.calls.map((c) => (c[1] as { subjectType: string }).subjectType)
    expect(surfaces.filter((s) => s === 'creator')).toHaveLength(2)
    expect(surfaces.filter((s) => s === 'consumer')).toHaveLength(2)
    const body = await res.json()
    expect(body.stats).toMatchObject({ creators_screened: 2, consumers_screened: 2, hits: 1 })
  })

  it('un throw por sujeto NO aborta el batch (se cuenta como failure)', async () => {
    creatorsRows = [
      { user_id: 'creator-1', pseudonym: null, country: null, sanctions_screened_at: null },
      { user_id: 'creator-boom', pseudonym: null, country: null, sanctions_screened_at: null },
      { user_id: 'creator-3', pseudonym: null, country: null, sanctions_screened_at: null },
    ]
    throwIds = new Set(['creator-boom'])

    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    // Los 3 se intentaron (el throw del medio no cortó el loop).
    expect(screenSpy).toHaveBeenCalledTimes(3)
    const body = await res.json()
    expect(body.stats).toMatchObject({ creators_screened: 2, failures: 1 })
  })

  it('los pagadores vienen de la RPC stale_consumer_payers (distinct+order+limit en DB)', async () => {
    process.env.AML_RESCREEN_DAYS = '7'
    consumerRows = [{ id: 'fan-1', consumer_screened_at: null }]
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    // Una fila devuelta ⇒ un screen (el dedup/orden/límite lo hace la DB, no la app).
    expect(screenSpy).toHaveBeenCalledTimes(1)
    // La RPC se llamó con el cutoff (JS) + el batch limit.
    const call = rpcCalls.find((c) => c.name === 'stale_consumer_payers')
    expect(call).toBeTruthy()
    const params = call!.params as { p_cutoff: string; p_limit: number }
    expect(params.p_limit).toBe(50)
    const cutoffMs = new Date(params.p_cutoff).getTime()
    expect(Math.abs(cutoffMs - (Date.now() - 7 * 24 * 60 * 60 * 1000))).toBeLessThan(60_000)
  })

  it('cutoff de frescura: computado en JS desde AML_RESCREEN_DAYS y pasado al filtro .or', async () => {
    process.env.AML_RESCREEN_DAYS = '7'
    creatorsRows = []
    await GET(req(`Bearer ${SECRET}`))
    // El filtro de creadoras: "<col>.is.null,<col>.lt.<iso>".
    const filter = orFilters.find((f) => f.startsWith('sanctions_screened_at.is.null'))
    expect(filter).toBeTruthy()
    const iso = filter!.split('lt.')[1]
    const cutoffMs = new Date(iso).getTime()
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000
    // ~7 días atrás, con holgura de reloj.
    expect(Math.abs(cutoffMs - expected)).toBeLessThan(60_000)
  })
})
