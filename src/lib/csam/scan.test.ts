// @vitest-environment node
/**
 * CSAM scan pipeline — the fail-closed core (pilar #0).
 *
 * Covers:
 *   · claimForScan: atomic uploaded→csam_scanning; second claim loses.
 *   · scanAndApply pass → csam_status='pass' + in_review + re-read confirms.
 *   · scanAndApply blocked → handleHit: PRESERVE evidence BEFORE block, durable
 *     incident, hard block (removed), NCMEC report.
 *   · possible_minor is a HARD HIT even when verdict='review'.
 *   · review → in_review, csam_status stays 'pending' (never auto-pass).
 *   · provider error → FAIL-CLOSED: csam_status stays 'pending', row requeued.
 *   · preservation failure ABORTS before any block/incident (fail-closed).
 *   · applyPass persistence guard: a non-persisting write (guard revert) throws.
 *   · terminal-status rows are a no-op (idempotent).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CsamScanResult } from './provider'

// ─── Mocks (declared before importing the module under test) ────────────
let scanImpl: (input: unknown) => Promise<CsamScanResult>
vi.mock('./index', () => ({
  getCsamProvider: () => ({ name: 'stub', scan: (i: unknown) => scanImpl(i) }),
}))

let ncmecImpl: (i: unknown) => Promise<{ ok: boolean; reportId?: string; error?: string }>
vi.mock('./ncmec', () => ({
  getNcmecReporter: () => ({ report: (i: unknown) => ncmecImpl(i) }),
}))

const auditEvents: string[] = []
vi.mock('@/lib/audit', () => ({
  recordAudit: (o: { eventType: string }) => {
    auditEvents.push(o.eventType)
    return Promise.resolve()
  },
}))

import { claimForScan, scanAndApply } from './scan'

// ─── Fake admin client (stateful, ordered event log) ────────────────────

type ContentRow = {
  id: string
  creator_id: string
  media_ref: string | null
  media_type: string | null
  status: string
  csam_status: string
}

type Opts = {
  content: ContentRow | null
  errors?: {
    download?: string
    upload?: string
    blockUpdate?: string
    incidentInsert?: { message: string; code?: string }
  }
  existingIncident?: { id: string; ncmec_status: string } | null
  guardRevert?: boolean
}

function makeAdmin(opts: Opts) {
  const state = {
    content: opts.content ? { ...opts.content } : (null as ContentRow | null),
    incidents: [] as Array<Record<string, unknown>>,
  }
  if (opts.existingIncident) {
    state.incidents.push({
      id: opts.existingIncident.id,
      content_id: opts.content?.id ?? null,
      ncmec_status: opts.existingIncident.ncmec_status,
    })
  }
  const events: string[] = []
  let seq = 0

  const from = (table: string) => {
    let op: 'select' | 'update' | 'insert' = 'select'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payload: any = null
    const filters: Record<string, unknown> = {}
    let hasReturning = false

    const applyContentUpdate = () => {
      const row = state.content
      if (!row) return 0
      if (filters.id && row.id !== filters.id) return 0
      if (filters.status && row.status !== filters.status) return 0
      // Simulate content_guard_privileged reverting a non-service write: the
      // pass update "succeeds" but csam_status/status are NOT persisted.
      if (opts.guardRevert && payload.csam_status === 'pass') {
        events.push('content.pass(reverted)')
        return 1
      }
      Object.assign(row, payload)
      if (payload.csam_status === 'blocked') events.push('content.block')
      else if (payload.csam_status === 'pass') events.push('content.pass')
      else if (payload.status === 'uploaded') events.push('content.requeue')
      else if (payload.status === 'in_review') events.push('content.review')
      else if (payload.status === 'csam_scanning') events.push('content.claim')
      return 1
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compute = (shape: 'single' | 'array'): any => {
      if (op === 'select') {
        if (table === 'content') {
          const row = state.content && (!filters.id || state.content.id === filters.id) ? state.content : null
          return { data: shape === 'array' ? (row ? [row] : []) : row, error: null }
        }
        // csam_incidents select by content_id
        const inc = state.incidents.find((i) => i.content_id === filters.content_id) ?? null
        return { data: shape === 'array' ? (inc ? [inc] : []) : inc, error: null }
      }
      if (op === 'update') {
        if (table === 'content') {
          if (payload.csam_status === 'blocked' && opts.errors?.blockUpdate) {
            return { data: null, error: { message: opts.errors.blockUpdate } }
          }
          const affected = applyContentUpdate()
          return { data: hasReturning ? (affected ? [{ id: filters.id }] : []) : null, error: null }
        }
        // csam_incidents update by id
        const inc = state.incidents.find((i) => i.id === filters.id)
        if (inc) Object.assign(inc, payload)
        events.push('incident.update')
        return { data: null, error: null }
      }
      // insert csam_incidents
      const dup = state.incidents.find((i) => i.content_id === payload.content_id)
      if (dup) return { data: null, error: { message: 'duplicate', code: '23505' } }
      if (opts.errors?.incidentInsert) {
        return { data: null, error: opts.errors.incidentInsert }
      }
      const id = `inc-${++seq}`
      state.incidents.push({ id, ...payload })
      events.push('incident.insert')
      return { data: { id }, error: null }
    }

    const builder: Record<string, unknown> = {
      select: (_cols?: unknown) => { if (op !== 'select') hasReturning = true; return builder },
      update: (p: unknown) => { op = 'update'; payload = p; return builder },
      insert: (p: unknown) => { op = 'insert'; payload = p; return builder },
      eq: (col: string, val: unknown) => { filters[col] = val; return builder },
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve(compute('single')),
      single: () => Promise.resolve(compute('single')),
      then: (resolve: (v: unknown) => unknown) => resolve(compute('array')),
    }
    return builder
  }

  const storage = {
    from: (bucket: string) => ({
      download: (_path: string) => {
        if (opts.errors?.download) return Promise.resolve({ data: null, error: { message: opts.errors.download } })
        events.push(`storage.download:${bucket}`)
        return Promise.resolve({ data: new Blob(['bytes'], { type: 'image/jpeg' }), error: null })
      },
      upload: (_path: string, _blob: unknown, _o: unknown) => {
        if (opts.errors?.upload) return Promise.resolve({ data: null, error: { message: opts.errors.upload } })
        events.push(`storage.upload:${bucket}`)
        return Promise.resolve({ data: { path: _path }, error: null })
      },
    }),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: { from, storage } as any, state, events }
}

const baseContent = (over: Partial<ContentRow> = {}): ContentRow => ({
  id: 'content-1',
  creator_id: 'creator-1',
  media_ref: 'creator-1/uuid/media.jpg',
  media_type: 'image',
  status: 'csam_scanning',
  csam_status: 'pending',
  ...over,
})

beforeEach(() => {
  auditEvents.length = 0
  scanImpl = async () => ({ verdict: 'pass', provider: 'stub' })
  ncmecImpl = async () => ({ ok: true, reportId: 'STUB-NCMEC-inc-1' })
})

describe('claimForScan', () => {
  it('claims a uploaded row atomically; a second claim loses', async () => {
    const { admin, state } = makeAdmin({ content: baseContent({ status: 'uploaded' }) })
    expect(await claimForScan(admin, 'content-1')).toBe(true)
    expect(state.content!.status).toBe('csam_scanning')
    // Now no longer 'uploaded' → the conditional update affects 0 rows.
    expect(await claimForScan(admin, 'content-1')).toBe(false)
  })
})

describe('scanAndApply · pass', () => {
  it('marks csam_status=pass + in_review and re-reads to confirm persistence', async () => {
    scanImpl = async () => ({ verdict: 'pass', provider: 'stub', score: 0 })
    const { admin, state } = makeAdmin({ content: baseContent() })
    const out = await scanAndApply(admin, 'content-1')
    expect(out).toEqual({ ok: true, status: 'pass' })
    expect(state.content!.csam_status).toBe('pass')
    expect(state.content!.status).toBe('in_review')
    expect(auditEvents).toContain('csam_scan_pass')
  })

  it('FAIL-CLOSED: a non-persisting pass write (guard revert) throws → requeue', async () => {
    scanImpl = async () => ({ verdict: 'pass', provider: 'stub' })
    const { admin, state } = makeAdmin({ content: baseContent(), guardRevert: true })
    const out = await scanAndApply(admin, 'content-1')
    expect(out.ok).toBe(false)
    expect(state.content!.csam_status).toBe('pending') // never advanced
    expect(state.content!.status).toBe('uploaded') // requeued for retry
    expect(auditEvents).toContain('csam_scan_error')
  })
})

describe('scanAndApply · review', () => {
  it('routes to in_review and NEVER auto-passes (csam_status stays pending)', async () => {
    scanImpl = async () => ({ verdict: 'review', provider: 'stub' })
    const { admin, state } = makeAdmin({ content: baseContent() })
    const out = await scanAndApply(admin, 'content-1')
    expect(out).toEqual({ ok: true, status: 'review' })
    expect(state.content!.status).toBe('in_review')
    expect(state.content!.csam_status).toBe('pending')
    expect(auditEvents).toContain('csam_scan_review')
  })
})

describe('scanAndApply · blocked hit', () => {
  it('PRESERVES evidence BEFORE blocking, records a durable incident, blocks, reports NCMEC', async () => {
    scanImpl = async () => ({ verdict: 'blocked', matchType: 'known_hash', provider: 'stub', score: 1 })
    const { admin, state, events } = makeAdmin({ content: baseContent() })
    const out = await scanAndApply(admin, 'content-1')

    expect(out).toEqual({ ok: true, status: 'blocked' })
    // hard block
    expect(state.content!.csam_status).toBe('blocked')
    expect(state.content!.status).toBe('removed')
    // durable incident
    expect(state.incidents).toHaveLength(1)
    expect(state.incidents[0]).toMatchObject({
      content_id: 'content-1',
      match_type: 'known_hash',
      ncmec_status: 'reported',
      evidence_path: 'creator-1/content-1/media',
    })
    // ORDER: evidence preserved (upload) BEFORE the content block, and the
    // incident is inserted before the block too.
    const iUpload = events.indexOf('storage.upload:csam-evidence')
    const iInsert = events.indexOf('incident.insert')
    const iBlock = events.indexOf('content.block')
    expect(iUpload).toBeGreaterThanOrEqual(0)
    expect(iUpload).toBeLessThan(iBlock)
    expect(iInsert).toBeLessThan(iBlock)
    // audit trail
    expect(auditEvents).toEqual(
      expect.arrayContaining(['csam_evidence_preserved', 'csam_hit_blocked', 'csam_ncmec_reported']),
    )
  })

  it("treats 'possible minor' as a HARD HIT even when verdict='review'", async () => {
    scanImpl = async () => ({ verdict: 'review', matchType: 'classifier_possible_minor', provider: 'stub' })
    const { admin, state } = makeAdmin({ content: baseContent() })
    const out = await scanAndApply(admin, 'content-1')
    expect(out).toEqual({ ok: true, status: 'blocked' })
    expect(state.content!.csam_status).toBe('blocked')
    expect(state.content!.status).toBe('removed')
    expect(state.incidents[0]).toMatchObject({ match_type: 'classifier_possible_minor' })
  })

  it('FAIL-CLOSED: preservation failure ABORTS before any block or incident', async () => {
    scanImpl = async () => ({ verdict: 'blocked', matchType: 'known_hash', provider: 'stub' })
    const { admin, state, events } = makeAdmin({
      content: baseContent(),
      errors: { download: 'storage down' },
    })
    const out = await scanAndApply(admin, 'content-1')
    expect(out.ok).toBe(false)
    // nothing marked, original never touched, no incident
    expect(state.content!.csam_status).toBe('pending')
    expect(state.content!.status).toBe('uploaded') // requeued
    expect(state.incidents).toHaveLength(0)
    expect(events).not.toContain('content.block')
    expect(events).not.toContain('incident.insert')
  })

  it('reports NCMEC failure as durable failed (block still applied, no throw)', async () => {
    scanImpl = async () => ({ verdict: 'blocked', matchType: 'known_hash', provider: 'stub' })
    ncmecImpl = async () => ({ ok: false, error: 'ncmec 503' })
    const { admin, state } = makeAdmin({ content: baseContent() })
    const out = await scanAndApply(admin, 'content-1')
    expect(out).toEqual({ ok: true, status: 'blocked' })
    expect(state.content!.csam_status).toBe('blocked')
    expect(state.incidents[0].ncmec_status).toBe('failed')
    expect(auditEvents).toContain('csam_ncmec_failed')
  })

  it('does not duplicate an incident when one already exists (idempotent)', async () => {
    scanImpl = async () => ({ verdict: 'blocked', matchType: 'known_hash', provider: 'stub' })
    const { admin, state } = makeAdmin({
      content: baseContent(),
      existingIncident: { id: 'inc-existing', ncmec_status: 'reported' },
    })
    const out = await scanAndApply(admin, 'content-1')
    expect(out).toEqual({ ok: true, status: 'blocked' })
    expect(state.incidents).toHaveLength(1) // reused, not duplicated
    expect(state.content!.csam_status).toBe('blocked')
  })
})

describe('scanAndApply · idempotency', () => {
  it('no-ops when the row is not in csam_scanning (terminal status)', async () => {
    const { admin } = makeAdmin({ content: baseContent({ status: 'published', csam_status: 'pass' }) })
    const out = await scanAndApply(admin, 'content-1')
    expect(out).toEqual({ ok: true, status: 'skipped', reason: 'status=published' })
  })

  it('errors when the content row is absent', async () => {
    const { admin } = makeAdmin({ content: null })
    const out = await scanAndApply(admin, 'nope')
    expect(out).toEqual({ ok: false, status: 'error', reason: 'content not found' })
  })
})
