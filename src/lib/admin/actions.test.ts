// @vitest-environment node
// Pure-function tests — supabase client is injected, no DOM required.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  approveReview, rejectReview,
  approveStory, rejectStory,
  approveVerification, rejectVerification,
  dismissReport, deletePostFromReport,
  togglePostHidden, associatePostToUser,
  rejectPost, deletePost, togglePostVerified,
  verifyPostWithId, rejectPostIdDocument,
} from './actions'

/**
 * Build a fake Supabase client that captures the call chain.
 *
 * Each from() call logs a "trace" we can assert against. The builder is
 * thenable, so awaiting any chain (…update().eq() or …update().eq().select())
 * resolves to a controllable { data, error }. Pass errorByTable to simulate a
 * DB error; pass dataByTable to control the rows returned — use [] to simulate
 * an UPDATE that matched 0 rows.
 */
function buildFake(
  errorByTable: Record<string, { message: string } | null> = {},
  dataByTable: Record<string, unknown[]> = {},
) {
  const trace: Array<{ table: string; op: string; payload: unknown; filter: unknown }> = []

  const make = (table: string) => {
    let op = 'select'
    let payload: unknown = null
    const result = () => ({
      data: dataByTable[table] ?? [{ id: 'row-1' }],
      error: errorByTable[table] ?? null,
    })
    const builder: Record<string, unknown> = {
      select: vi.fn(() => { op = 'select'; return builder }),
      insert: vi.fn((p: unknown) => { op = 'insert'; payload = p; return builder }),
      update: vi.fn((p: unknown) => { op = 'update'; payload = p; return builder }),
      delete: vi.fn(() => { op = 'delete'; return builder }),
      upsert: vi.fn((p: unknown, opts?: unknown) => {
        op = 'upsert'; payload = p
        // upsert has no .eq() step, so trace it here (filter = the options object).
        trace.push({ table, op, payload, filter: opts ?? null })
        return builder
      }),
      eq: vi.fn((col: string, val: unknown) => {
        trace.push({ table, op, payload, filter: { [col]: val } })
        return builder
      }),
      neq: vi.fn(() => builder),
      single: vi.fn(() => Promise.resolve({ data: null, error: errorByTable[table] ?? null })),
      then: (resolve: (v: unknown) => unknown) => resolve(result()),
    }
    return builder
  }

  return {
    client: { from: vi.fn((t: string) => make(t)) } as unknown as SupabaseClient,
    trace,
  }
}

beforeEach(() => { vi.clearAllMocks() })

describe('approveReview', () => {
  it("sets status='pending_owner' + admin_reviewed_at on the target review", async () => {
    const { client, trace } = buildFake()
    const result = await approveReview(client, 'review-1')
    expect(result.ok).toBe(true)
    expect(trace[0].table).toBe('reviews')
    expect(trace[0].op).toBe('update')
    expect(trace[0].filter).toEqual({ id: 'review-1' })
    const payload = trace[0].payload as Record<string, unknown>
    expect(payload.status).toBe('pending_owner')
    expect(typeof payload.admin_reviewed_at).toBe('string')
  })

  it('returns error when DB rejects', async () => {
    const { client } = buildFake({ reviews: { message: 'permission denied' } })
    const result = await approveReview(client, 'review-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('permission denied')
  })
})

describe('rejectReview', () => {
  it("sets status='rejected_admin' + admin_reviewed_at", async () => {
    const { client, trace } = buildFake()
    await rejectReview(client, 'review-2')
    expect(trace[0].op).toBe('update')
    expect(trace[0].filter).toEqual({ id: 'review-2' })
    const payload = trace[0].payload as Record<string, unknown>
    expect(payload.status).toBe('rejected_admin')
    expect(typeof payload.admin_reviewed_at).toBe('string')
  })

  it('includes admin_review_reason when provided', async () => {
    const { client, trace } = buildFake()
    await rejectReview(client, 'review-3', 'contiene datos personales')
    const payload = trace[0].payload as Record<string, unknown>
    expect(payload.admin_review_reason).toBe('contiene datos personales')
  })
})

describe('approveStory', () => {
  it("sets status='approved'", async () => {
    const { client, trace } = buildFake()
    await approveStory(client, 'story-1')
    expect(trace[0].payload).toEqual({ status: 'approved' })
  })
})

describe('rejectStory', () => {
  it("sets status='rejected' + rejection_reason when provided", async () => {
    const { client, trace } = buildFake()
    await rejectStory(client, 'story-1', 'contenido inapropiado')
    expect(trace[0].payload).toEqual({
      status: 'rejected',
      rejection_reason: 'contenido inapropiado',
    })
  })

  it('stores null rejection_reason when empty', async () => {
    const { client, trace } = buildFake()
    await rejectStory(client, 'story-1', '')
    expect(trace[0].payload).toEqual({ status: 'rejected', rejection_reason: null })
  })
})

describe('approveVerification', () => {
  it('cascades approval to both profile AND all posts', async () => {
    const { client, trace } = buildFake()
    await approveVerification(client, 'profile-9')
    // Must hit profiles first, then posts — order matters for UX (badge).
    expect(trace[0]).toMatchObject({
      table: 'profiles',
      op: 'update',
      payload: { verification_status: 'approved', identity_verified: true },
    })
    expect(trace[1]).toMatchObject({
      table: 'posts',
      op: 'update',
      payload: { identity_verified: true, verification_status: 'approved' },
    })
  })

  it('short-circuits if profile update fails, does not touch posts', async () => {
    const { client, trace } = buildFake({ profiles: { message: 'nope' } })
    const result = await approveVerification(client, 'profile-9')
    expect(result.ok).toBe(false)
    expect(trace.length).toBe(1) // posts update never ran
  })

  it('marks the creators row verified; age_verified=false without attestation', async () => {
    const { client, trace } = buildFake()
    await approveVerification(client, 'profile-9')
    const creators = trace.find((t) => t.table === 'creators')!
    expect(creators.op).toBe('upsert')
    expect(creators.filter).toEqual({ onConflict: 'user_id' })
    const payload = creators.payload as Record<string, unknown>
    expect(payload).toMatchObject({ user_id: 'profile-9', kyc_status: 'verified', age_verified: false })
    expect(payload.age_verified_at).toBeUndefined()
  })

  it('sets age_verified=true (+ age_verified_at) when ageAttested', async () => {
    const { client, trace } = buildFake()
    await approveVerification(client, 'profile-9', { ageAttested: true })
    const payload = trace.find((t) => t.table === 'creators')!.payload as Record<string, unknown>
    expect(payload.age_verified).toBe(true)
    expect(typeof payload.age_verified_at).toBe('string')
  })

  it('flags an explicit error when the profile update matches 0 rows', async () => {
    const { client, trace } = buildFake({}, { profiles: [] })
    const result = await approveVerification(client, 'profile-9')
    expect(result.ok).toBe(false)
    expect(trace.length).toBe(1) // posts cascade never ran
  })
})

describe('rejectVerification', () => {
  it('requires a non-empty reason', async () => {
    const { client } = buildFake()
    const result = await rejectVerification(client, 'profile-9', '   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Reason is required')
  })

  it('stores the reason on profile and cascades to posts', async () => {
    const { client, trace } = buildFake()
    await rejectVerification(client, 'profile-9', 'Documento borroso')
    expect(trace[0].payload).toEqual({
      verification_status: 'rejected',
      verification_note: 'Documento borroso',
      identity_verified: false,
    })
    expect(trace[1].table).toBe('posts')
    const creators = trace.find((t) => t.table === 'creators')!
    expect(creators.op).toBe('upsert')
    expect(creators.filter).toEqual({ onConflict: 'user_id' })
    expect(creators.payload).toEqual({ user_id: 'profile-9', kyc_status: 'rejected', age_verified: false })
  })

  it('flags an explicit error when the profile update matches 0 rows', async () => {
    const { client, trace } = buildFake({}, { profiles: [] })
    const result = await rejectVerification(client, 'profile-9', 'Documento borroso')
    expect(result.ok).toBe(false)
    expect(trace.length).toBe(1) // posts cascade never ran
  })
})

describe('dismissReport', () => {
  it("sets status='dismissed'", async () => {
    const { client, trace } = buildFake()
    await dismissReport(client, 'rep-1')
    expect(trace[0].payload).toEqual({ status: 'dismissed' })
  })
})

describe('deletePostFromReport', () => {
  it('deletes the post and marks the report reviewed (in that order)', async () => {
    const { client, trace } = buildFake()
    await deletePostFromReport(client, 'rep-1', 'post-7')
    expect(trace[0]).toMatchObject({ table: 'posts', op: 'delete' })
    expect(trace[1]).toMatchObject({
      table: 'reports',
      op: 'update',
      payload: { status: 'reviewed' },
    })
  })

  it('bails if the post delete fails — leaves the report untouched', async () => {
    const { client, trace } = buildFake({ posts: { message: 'foreign key violation' } })
    const result = await deletePostFromReport(client, 'rep-1', 'post-7')
    expect(result.ok).toBe(false)
    expect(trace.length).toBe(1) // report update never ran
  })
})

describe('togglePostHidden', () => {
  it('flips is_hidden to the passed value', async () => {
    const { client, trace } = buildFake()
    await togglePostHidden(client, 'post-1', true)
    expect(trace[0].payload).toEqual({ is_hidden: true })
    await togglePostHidden(client, 'post-1', false)
    expect(trace[1].payload).toEqual({ is_hidden: false })
  })
})

describe('associatePostToUser', () => {
  it('updates user_id on the target post', async () => {
    const { client, trace } = buildFake()
    await associatePostToUser(client, 'post-1', 'user-42')
    expect(trace[0].payload).toEqual({ user_id: 'user-42' })
    expect(trace[0].filter).toEqual({ id: 'post-1' })
  })
})

describe('rejectPost', () => {
  it('requires a non-empty reason', async () => {
    const { client } = buildFake()
    const result = await rejectPost(client, 'post-1', '   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Reason is required')
  })

  it('sets status=rejected, is_approved=false, stores reason', async () => {
    const { client, trace } = buildFake()
    await rejectPost(client, 'post-1', 'Contenido duplicado')
    expect(trace[0].payload).toEqual({
      status: 'rejected',
      is_approved: false,
      rejection_reason: 'Contenido duplicado',
    })
    expect(trace[0].filter).toEqual({ id: 'post-1' })
  })
})

describe('deletePost', () => {
  it('deletes the row by id', async () => {
    const { client, trace } = buildFake()
    await deletePost(client, 'post-1')
    expect(trace[0].op).toBe('delete')
    expect(trace[0].filter).toEqual({ id: 'post-1' })
  })
})

describe('togglePostVerified', () => {
  it('flips identity_verified to the passed value', async () => {
    const { client, trace } = buildFake()
    await togglePostVerified(client, 'post-1', true)
    expect(trace[0].payload).toEqual({ identity_verified: true })
    await togglePostVerified(client, 'post-1', false)
    expect(trace[1].payload).toEqual({ identity_verified: false })
  })
})

describe('verifyPostWithId', () => {
  it('flips identity_verified=true (alias of toggle → true)', async () => {
    const { client, trace } = buildFake()
    await verifyPostWithId(client, 'post-1')
    expect(trace[0].payload).toEqual({ identity_verified: true })
  })
})

describe('rejectPostIdDocument', () => {
  it('clears id_document_url AND drops identity_verified badge', async () => {
    const { client, trace } = buildFake()
    await rejectPostIdDocument(client, 'post-1')
    expect(trace[0].payload).toEqual({ identity_verified: false, id_document_url: null })
  })
})
