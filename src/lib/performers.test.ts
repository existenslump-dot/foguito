// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createPerformer,
  ensureSelfPerformerFromDidit,
  completePerformer,
  getPerformerForReview,
  listIncompletePerformers,
  listPerformersForOwner,
} from './performers'
import { encryptString } from './didit/crypto'

const HEX_KEY = '0'.repeat(64)

type Call = { table: string; op: string; payload: unknown }

function buildFake(
  cfg: {
    insertData?: { id: string } | null
    insertError?: { message: string } | null
    selectData?: unknown
    selectError?: { message: string } | null
    updateData?: unknown[] | null
    updateError?: { message: string } | null
    signedUrl?: string | null
  } = {},
) {
  const calls: Call[] = []

  const make = (table: string) => {
    let op = 'select'
    let payload: unknown = null
    const builder: Record<string, unknown> = {
      insert: vi.fn((p: unknown) => { op = 'insert'; payload = p; return builder }),
      update: vi.fn((p: unknown) => { op = 'update'; payload = p; return builder }),
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      single: vi.fn(() => {
        calls.push({ table, op, payload })
        return Promise.resolve({
          data: cfg.insertData === undefined ? { id: 'perf-new' } : cfg.insertData,
          error: cfg.insertError ?? null,
        })
      }),
      maybeSingle: vi.fn(() => {
        calls.push({ table, op, payload })
        return Promise.resolve({ data: cfg.selectData ?? null, error: cfg.selectError ?? null })
      }),
      then: (resolve: (v: unknown) => unknown) => {
        calls.push({ table, op, payload })
        const res =
          op === 'update'
            ? { data: cfg.updateData === undefined ? [{ id: 'perf-x' }] : cfg.updateData, error: cfg.updateError ?? null }
            : op === 'insert'
              ? { data: null, error: cfg.insertError ?? null }
              : { data: cfg.selectData ?? null, error: cfg.selectError ?? null }
        return resolve(res)
      },
    }
    return builder
  }

  const storage = {
    from: vi.fn(() => ({
      createSignedUrl: vi.fn(() =>
        Promise.resolve({
          data: cfg.signedUrl === null ? null : { signedUrl: cfg.signedUrl ?? 'https://signed/doc' },
          error: null,
        }),
      ),
    })),
  }

  return { client: { from: vi.fn(make), storage } as unknown as SupabaseClient, calls }
}

const findCall = (calls: Call[], op: string) => calls.find((c) => c.op === op)

beforeEach(() => vi.stubEnv('DIDIT_PAYLOAD_KEY', HEX_KEY))
afterEach(() => vi.unstubAllEnvs())

describe('performers · createPerformer', () => {
  it('inserts encrypted legal name + doc path and returns the id', async () => {
    const { client, calls } = buildFake({ insertData: { id: 'perf-42' } })
    const r = await createPerformer(client, {
      addedBy: 'creator-1',
      legalName: 'Ada Lovelace',
      idDocPath: 'creator-1/performers/abc/id_doc.jpg',
      custodian: 'creadora',
    })
    expect(r).toEqual({ ok: true, id: 'perf-42' })
    const p = findCall(calls, 'insert')!.payload as Record<string, unknown>
    expect(p.added_by).toBe('creator-1')
    expect(p.id_doc_path).toBe('creator-1/performers/abc/id_doc.jpg')
    expect(p.custodian).toBe('creadora')
    expect(p.is_self).toBe(false)
    // legal name never stored in the clear
    expect(String(p.legal_name_enc)).toMatch(/^v1\./)
    expect(String(p.legal_name_enc)).not.toContain('Ada')
  })

  it('INVARIANTE #1: NEVER sends is_complete / dob_verified (they stay default false)', async () => {
    const { client, calls } = buildFake()
    await createPerformer(client, {
      addedBy: 'creator-1',
      legalName: 'X',
      idDocPath: 'creator-1/performers/x/id_doc.png',
    })
    const p = findCall(calls, 'insert')!.payload as Record<string, unknown>
    expect(p).not.toHaveProperty('is_complete')
    expect(p).not.toHaveProperty('dob_verified')
  })

  it('propagates an insert error', async () => {
    const { client } = buildFake({ insertData: null, insertError: { message: 'db down' } })
    const r = await createPerformer(client, { addedBy: 'c', legalName: 'X', idDocPath: 'p' })
    expect(r).toEqual({ ok: false, error: 'db down' })
  })
})

describe('performers · ensureSelfPerformerFromDidit', () => {
  it('inserts the self record with is_self/is_complete/dob_verified = true (no existing)', async () => {
    const { client, calls } = buildFake({ selectData: null })
    const r = await ensureSelfPerformerFromDidit(client, 'creator-1', {
      legalName: 'Ada Lovelace',
      sessionId: 'sess-9',
    })
    expect(r.ok).toBe(true)
    const p = findCall(calls, 'insert')!.payload as Record<string, unknown>
    expect(p).toMatchObject({
      added_by: 'creator-1',
      didit_session_id: 'sess-9',
      custodian: 'didit',
      is_self: true,
      dob_verified: true,
      is_complete: true,
    })
    expect(String(p.legal_name_enc)).toMatch(/^v1\./)
  })

  it('updates the existing self record instead of inserting (idempotent)', async () => {
    const { client, calls } = buildFake({ selectData: { id: 'self-existing' } })
    const r = await ensureSelfPerformerFromDidit(client, 'creator-1', { legalName: 'Ada', sessionId: 's2' })
    expect(r.ok).toBe(true)
    expect(findCall(calls, 'insert')).toBeUndefined()
    const p = findCall(calls, 'update')!.payload as Record<string, unknown>
    expect(p).toMatchObject({ is_self: true, is_complete: true, dob_verified: true })
  })

  it('still creates the self record with an empty (encrypted) name when Didit gave none', async () => {
    const { client, calls } = buildFake({ selectData: null })
    const r = await ensureSelfPerformerFromDidit(client, 'creator-1', { legalName: '', sessionId: null })
    expect(r.ok).toBe(true)
    const p = findCall(calls, 'insert')!.payload as Record<string, unknown>
    expect(p.is_complete).toBe(true)
    expect(String(p.legal_name_enc)).toMatch(/^v1\./) // empty string, still encrypted
  })

  it('non-fatal on a DB error', async () => {
    const { client } = buildFake({ selectData: null, insertError: { message: 'boom' } })
    const r = await ensureSelfPerformerFromDidit(client, 'creator-1', { legalName: 'X' })
    expect(r.ok).toBe(false)
  })
})

describe('performers · completePerformer', () => {
  it('sets is_complete + dob_verified = true', async () => {
    const { client, calls } = buildFake({ updateData: [{ id: 'perf-1' }] })
    const r = await completePerformer(client, 'perf-1')
    expect(r.ok).toBe(true)
    const p = findCall(calls, 'update')!.payload as Record<string, unknown>
    expect(p).toEqual({ is_complete: true, dob_verified: true })
  })

  it('returns not found when no row matched', async () => {
    const { client } = buildFake({ updateData: [] })
    const r = await completePerformer(client, 'missing')
    expect(r).toEqual({ ok: false, error: 'performer not found' })
  })
})

describe('performers · getPerformerForReview', () => {
  it('decrypts the legal name and signs the doc URL', async () => {
    const enc = encryptString('Grace Hopper')
    const { client } = buildFake({
      selectData: {
        id: 'perf-7',
        added_by: 'creator-1',
        legal_name_enc: enc,
        id_doc_path: 'creator-1/performers/xyz/id_doc.jpg',
        custodian: 'creadora',
        didit_session_id: null,
        is_self: false,
        is_complete: false,
        dob_verified: false,
        created_at: '2026-07-11T00:00:00Z',
      },
      signedUrl: 'https://signed/doc-7',
    })
    const r = await getPerformerForReview(client, 'perf-7')
    expect(r).not.toBeNull()
    expect(r!.legal_name).toBe('Grace Hopper')
    expect(r!.doc_url).toBe('https://signed/doc-7')
    expect(r!.is_complete).toBe(false)
    // never leaks the ciphertext column
    expect(r as unknown as Record<string, unknown>).not.toHaveProperty('legal_name_enc')
  })

  it('returns null when the record is absent', async () => {
    const { client } = buildFake({ selectData: null })
    expect(await getPerformerForReview(client, 'nope')).toBeNull()
  })

  it('tolerates undecryptable ciphertext (returns empty name, still succeeds)', async () => {
    const { client } = buildFake({
      selectData: {
        id: 'perf-8', added_by: 'c', legal_name_enc: 'garbage', id_doc_path: null,
        custodian: null, didit_session_id: null, is_self: false, is_complete: false,
        dob_verified: false, created_at: '2026-07-11T00:00:00Z',
      },
    })
    const r = await getPerformerForReview(client, 'perf-8')
    expect(r!.legal_name).toBe('')
    expect(r!.doc_url).toBeNull()
  })
})

describe('performers · list helpers', () => {
  it('listIncompletePerformers returns safe summaries (no legal name)', async () => {
    const rows = [{ id: 'p1', added_by: 'c1', custodian: null, is_self: false, is_complete: false, dob_verified: false, created_at: 'x' }]
    const { client } = buildFake({ selectData: rows })
    const r = await listIncompletePerformers(client)
    expect(r).toEqual({ ok: true, performers: rows })
  })

  it('listPerformersForOwner returns the owner rows', async () => {
    const rows = [{ id: 'p1', added_by: 'c1', custodian: 'x', is_self: true, is_complete: true, dob_verified: true, created_at: 'x' }]
    const { client } = buildFake({ selectData: rows })
    const r = await listPerformersForOwner(client, 'c1')
    expect(r).toEqual({ ok: true, performers: rows })
  })

  it('surfaces a select error', async () => {
    const { client } = buildFake({ selectData: null, selectError: { message: 'nope' } })
    const r = await listIncompletePerformers(client)
    expect(r).toEqual({ ok: false, error: 'nope' })
  })
})
