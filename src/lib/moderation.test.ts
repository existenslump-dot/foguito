// @vitest-environment node
/**
 * Tests de la lib de moderación (PR-9): tiering de SLA, cómputo de overdue y
 * listOpenComplaints (join seguro del contenido, sin media_ref).
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  slaDueAtForCategory,
  slaIntervalMs,
  isOverdue,
  listOpenComplaints,
  type ComplaintCategory,
} from './moderation'

const HOUR = 60 * 60 * 1000

describe('moderation · SLA tiering', () => {
  const now = 1_700_000_000_000

  it('escalona el intervalo por categoría (24h / 72h / 168h)', () => {
    expect(slaIntervalMs('illegal')).toBe(24 * HOUR)
    expect(slaIntervalMs('nonconsensual')).toBe(24 * HOUR)
    expect(slaIntervalMs('csam_suspected')).toBe(24 * HOUR)
    expect(slaIntervalMs('dmca')).toBe(72 * HOUR)
    expect(slaIntervalMs('spam')).toBe(168 * HOUR)
    expect(slaIntervalMs('other')).toBe(168 * HOUR)
  })

  it('slaDueAtForCategory = now + intervalo (ISO)', () => {
    const cases: Array<[ComplaintCategory, number]> = [
      ['illegal', 24],
      ['nonconsensual', 24],
      ['csam_suspected', 24],
      ['dmca', 72],
      ['spam', 168],
      ['other', 168],
    ]
    for (const [cat, hours] of cases) {
      expect(slaDueAtForCategory(cat, now)).toBe(new Date(now + hours * HOUR).toISOString())
    }
  })
})

describe('moderation · isOverdue', () => {
  const now = Date.parse('2026-07-12T00:00:00Z')

  it('open + sla vencido → true', () => {
    expect(isOverdue({ status: 'open', sla_due_at: '2026-07-11T00:00:00Z' }, now)).toBe(true)
  })
  it('open + sla futuro → false', () => {
    expect(isOverdue({ status: 'open', sla_due_at: '2026-07-13T00:00:00Z' }, now)).toBe(false)
  })
  it('triaging + sla vencido → false (sólo cuenta open)', () => {
    expect(isOverdue({ status: 'triaging', sla_due_at: '2026-07-11T00:00:00Z' }, now)).toBe(false)
  })
  it('open + sla null → false', () => {
    expect(isOverdue({ status: 'open', sla_due_at: null }, now)).toBe(false)
  })
})

// ── Fake admin client: resuelve por tabla, terminando en la thenable ──────────
function makeAdmin(opts: {
  events?: unknown[]
  eventsError?: { message: string } | null
  content?: unknown[]
}) {
  const from = vi.fn((table: string) => {
    const result =
      table === 'moderation_events'
        ? { data: opts.events ?? [], error: opts.eventsError ?? null }
        : { data: opts.content ?? [], error: null }
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      in: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      then: (resolve: (v: unknown) => unknown) => resolve(result),
    }
    return builder
  })
  return { from } as unknown as SupabaseClient
}

describe('moderation · listOpenComplaints', () => {
  const now = Date.parse('2026-07-12T00:00:00Z')

  it('adjunta content brief + computa overdue y flota las vencidas arriba', async () => {
    const events = [
      // NO vencida (sla futuro), viene primera en la data cruda…
      {
        id: 'q-fresh', content_id: 'c-fresh', creator_id: 'u1', reporter_user_id: null,
        reporter_ip: '1.1.1.1', category: 'dmca', description: null, status: 'open',
        sla_due_at: '2026-07-13T00:00:00Z', resolution: null, resolved_by: null,
        resolved_at: null, authority_export_status: 'none', created_at: '2026-07-11T00:00:00Z',
      },
      // …vencida, debe terminar ARRIBA tras el sort.
      {
        id: 'q-over', content_id: 'c-over', creator_id: 'u2', reporter_user_id: 'r1',
        reporter_ip: '2.2.2.2', category: 'illegal', description: 'ojo', status: 'open',
        sla_due_at: '2026-07-11T00:00:00Z', resolution: null, resolved_by: null,
        resolved_at: null, authority_export_status: 'none', created_at: '2026-07-11T12:00:00Z',
      },
    ]
    const content = [
      { id: 'c-fresh', title: 'Fresh', creator_id: 'u1', status: 'published' },
      { id: 'c-over', title: 'Over', creator_id: 'u2', status: 'published' },
    ]
    const admin = makeAdmin({ events, content })
    const res = await listOpenComplaints(admin, now)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // La vencida flota arriba.
    expect(res.complaints[0].id).toBe('q-over')
    expect(res.complaints[0].overdue).toBe(true)
    expect(res.complaints[1].id).toBe('q-fresh')
    expect(res.complaints[1].overdue).toBe(false)

    // Content brief adjunto (título/creadora/estado — sin media_ref).
    expect(res.complaints[0].content).toEqual({ id: 'c-over', title: 'Over', creator_id: 'u2', status: 'published' })
    expect(JSON.stringify(res.complaints)).not.toContain('media_ref')
  })

  it('content = null cuando la queja perdió su content_id (contenido borrado)', async () => {
    const events = [
      {
        id: 'q1', content_id: null, creator_id: 'u1', reporter_user_id: null,
        reporter_ip: null, category: 'spam', description: null, status: 'triaging',
        sla_due_at: null, resolution: null, resolved_by: null, resolved_at: null,
        authority_export_status: 'none', created_at: '2026-07-11T00:00:00Z',
      },
    ]
    const admin = makeAdmin({ events, content: [] })
    const res = await listOpenComplaints(admin, now)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.complaints[0].content).toBeNull()
    expect(res.complaints[0].overdue).toBe(false)
  })

  it('propaga un error de la query (fail-closed)', async () => {
    const admin = makeAdmin({ events: [], eventsError: { message: 'boom' } })
    const res = await listOpenComplaints(admin, now)
    expect(res).toEqual({ ok: false, error: 'boom' })
  })
})
