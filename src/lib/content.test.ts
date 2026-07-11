// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createContentDraft,
  getSelfPerformerId,
  linkPerformer,
  listContentForCreator,
  listContentForModeration,
  getContentForReview,
} from './content'

type Call = { table: string; op: string; payload: unknown }

function buildFake(
  cfg: {
    insertData?: { id: string } | null
    insertError?: { message: string } | null
    upsertError?: { message: string } | null
    selectData?: unknown
    selectError?: { message: string } | null
    signedUrl?: string | null
  } = {},
) {
  const calls: Call[] = []

  const make = (table: string) => {
    let op = 'select'
    let payload: unknown = null
    const builder: Record<string, unknown> = {
      insert: vi.fn((p: unknown) => { op = 'insert'; payload = p; return builder }),
      upsert: vi.fn((p: unknown) => { op = 'upsert'; payload = p; return builder }),
      update: vi.fn((p: unknown) => { op = 'update'; payload = p; return builder }),
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      single: vi.fn(() => {
        calls.push({ table, op, payload })
        return Promise.resolve({
          data: cfg.insertData === undefined ? { id: 'content-new' } : cfg.insertData,
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
          op === 'upsert'
            ? { data: null, error: cfg.upsertError ?? null }
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
          data: cfg.signedUrl === null ? null : { signedUrl: cfg.signedUrl ?? 'https://signed/media' },
          error: null,
        }),
      ),
    })),
  }

  return { client: { from: vi.fn(make), storage } as unknown as SupabaseClient, calls }
}

const findCall = (calls: Call[], op: string) => calls.find((c) => c.op === op)

describe('content · createContentDraft', () => {
  it('inserts a DRAFT with status=uploaded and returns the id', async () => {
    const { client, calls } = buildFake({ insertData: { id: 'c-42' } })
    const r = await createContentDraft(client, {
      creatorId: 'creator-1',
      title: 'mi post',
      caption: 'hola',
      mediaRef: 'creator-1/abc/media.jpg',
      mediaType: 'image',
      visibility: 'tier',
      requiredTier: 'gold',
    })
    expect(r).toEqual({ ok: true, id: 'c-42' })
    const p = findCall(calls, 'insert')!.payload as Record<string, unknown>
    expect(p.creator_id).toBe('creator-1')
    expect(p.media_ref).toBe('creator-1/abc/media.jpg')
    expect(p.media_type).toBe('image')
    expect(p.visibility).toBe('tier')
    expect(p.required_tier).toBe('gold')
    expect(p.status).toBe('uploaded')
  })

  it('INVARIANTE: NEVER sends csam_status / published_at / a published status', async () => {
    const { client, calls } = buildFake()
    await createContentDraft(client, {
      creatorId: 'creator-1',
      mediaRef: 'creator-1/x/media.mp4',
      mediaType: 'video',
      visibility: 'ppv',
      ppvPriceCredits: 50,
    })
    const p = findCall(calls, 'insert')!.payload as Record<string, unknown>
    expect(p.status).toBe('uploaded')
    expect(p).not.toHaveProperty('csam_status')
    expect(p).not.toHaveProperty('published_at')
    expect(p.ppv_price_credits).toBe(50)
  })

  it('propagates an insert error', async () => {
    const { client } = buildFake({ insertData: null, insertError: { message: 'db down' } })
    const r = await createContentDraft(client, {
      creatorId: 'c', mediaRef: 'p', mediaType: 'image', visibility: 'free_preview',
    })
    expect(r).toEqual({ ok: false, error: 'db down' })
  })
})

describe('content · getSelfPerformerId', () => {
  it('filters is_self + is_complete and returns the id', async () => {
    const { client, calls } = buildFake({ selectData: { id: 'perf-self' } })
    const id = await getSelfPerformerId(client, 'creator-1')
    expect(id).toBe('perf-self')
    // the query ran against performers_2257 (select op)
    expect(findCall(calls, 'select')!.table).toBe('performers_2257')
  })

  it('returns null when there is no complete self record', async () => {
    const { client } = buildFake({ selectData: null })
    expect(await getSelfPerformerId(client, 'creator-1')).toBeNull()
  })

  it('returns null on a select error (fail-closed)', async () => {
    const { client } = buildFake({ selectData: null, selectError: { message: 'boom' } })
    expect(await getSelfPerformerId(client, 'creator-1')).toBeNull()
  })
})

describe('content · linkPerformer', () => {
  it('upserts the content↔performer pair (idempotent)', async () => {
    const { client, calls } = buildFake()
    const r = await linkPerformer(client, 'c-1', 'perf-1')
    expect(r.ok).toBe(true)
    const p = findCall(calls, 'upsert')!.payload as Record<string, unknown>
    expect(p).toEqual({ content_id: 'c-1', performer_id: 'perf-1' })
  })

  it('surfaces an upsert error', async () => {
    const { client } = buildFake({ upsertError: { message: 'fk violation' } })
    const r = await linkPerformer(client, 'c-1', 'perf-1')
    expect(r).toEqual({ ok: false, error: 'fk violation' })
  })
})

describe('content · list helpers', () => {
  it('listContentForCreator returns the owner rows', async () => {
    const rows = [{ id: 'c1', creator_id: 'u1', status: 'uploaded' }]
    const { client } = buildFake({ selectData: rows })
    const r = await listContentForCreator(client, 'u1')
    expect(r).toEqual({ ok: true, content: rows })
  })

  it('listContentForModeration returns the queue rows', async () => {
    const rows = [{ id: 'c1', creator_id: 'u1', status: 'uploaded' }]
    const { client } = buildFake({ selectData: rows })
    const r = await listContentForModeration(client, ['uploaded', 'in_review'])
    expect(r).toEqual({ ok: true, content: rows })
  })

  it('surfaces a select error', async () => {
    const { client } = buildFake({ selectData: null, selectError: { message: 'nope' } })
    const r = await listContentForModeration(client, ['uploaded'])
    expect(r).toEqual({ ok: false, error: 'nope' })
  })
})

describe('content · getContentForReview', () => {
  it('signs the private media and strips the raw path', async () => {
    const { client } = buildFake({
      selectData: {
        id: 'c-7', creator_id: 'u1', title: 't', caption: null, media_type: 'image',
        visibility: 'tier', required_tier: 'gold', ppv_price_credits: null,
        status: 'uploaded', csam_status: 'pending', published_at: null,
        created_at: '2026-07-11T00:00:00Z', media_ref: 'u1/abc/media.jpg',
      },
      signedUrl: 'https://signed/media-7',
    })
    const r = await getContentForReview(client, 'c-7')
    expect(r).not.toBeNull()
    expect(r!.media_url).toBe('https://signed/media-7')
    // never leaks the raw private path
    expect(r as unknown as Record<string, unknown>).not.toHaveProperty('media_ref')
  })

  it('returns null when the record is absent', async () => {
    const { client } = buildFake({ selectData: null })
    expect(await getContentForReview(client, 'nope')).toBeNull()
  })

  it('PILAR #0: NEVER signs a blocked hit and flags media_blocked', async () => {
    let signCalled = false
    const { client } = buildFake({
      selectData: {
        id: 'c-9', creator_id: 'u1', title: null, caption: null, media_type: 'image',
        visibility: 'tier', required_tier: 'gold', ppv_price_credits: null,
        status: 'removed', csam_status: 'blocked', published_at: null,
        created_at: '2026-07-11T00:00:00Z', media_ref: 'u1/abc/media.jpg',
      },
    })
    // Spy on the storage signer so we can assert it's never invoked.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(client as any).storage.from = () => ({
      createSignedUrl: () => { signCalled = true; return Promise.resolve({ data: { signedUrl: 'x' }, error: null }) },
    })
    const r = await getContentForReview(client, 'c-9')
    expect(r).not.toBeNull()
    expect(r!.media_url).toBeNull()
    expect(r!.media_blocked).toBe(true)
    expect(signCalled).toBe(false)
    expect(r as unknown as Record<string, unknown>).not.toHaveProperty('media_ref')
  })

  it('media_blocked is false for a non-blocked row (still signs)', async () => {
    const { client } = buildFake({
      selectData: {
        id: 'c-8', creator_id: 'u1', title: null, caption: null, media_type: 'image',
        visibility: 'free_preview', required_tier: null, ppv_price_credits: null,
        status: 'in_review', csam_status: 'pass', published_at: null,
        created_at: '2026-07-11T00:00:00Z', media_ref: 'u1/abc/media.jpg',
      },
      signedUrl: 'https://signed/media-8',
    })
    const r = await getContentForReview(client, 'c-8')
    expect(r!.media_blocked).toBe(false)
    expect(r!.media_url).toBe('https://signed/media-8')
  })
})
