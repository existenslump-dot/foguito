// @vitest-environment node
// Pure-function tests — supabase admin client is injected, no network/DOM.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  purgeIdentityDocuments,
  getIdentityRetentionDays,
} from './identity-retention'

/**
 * Build a fake service-role client that captures storage + table calls.
 *
 * `listResult` controls what `storage.from('identity-documents').list(userId)`
 * returns. `removed`/`updated` traces let us assert exactly what was wiped.
 */
function buildFake(listResult: { data: { name: string }[] | null; error: { message: string } | null }) {
  const removed: string[][] = []
  const profileUpdates: Array<{ payload: unknown; filter: unknown }> = []

  const bucket = {
    list: vi.fn((_prefix: string) => Promise.resolve(listResult)),
    remove: vi.fn((paths: string[]) => {
      removed.push(paths)
      return Promise.resolve({ data: [], error: null })
    }),
  }

  const client = {
    storage: { from: vi.fn(() => bucket) },
    from: vi.fn((_table: string) => {
      let payload: unknown = null
      const builder: Record<string, unknown> = {
        update: vi.fn((p: unknown) => { payload = p; return builder }),
        eq: vi.fn((col: string, val: unknown) => {
          profileUpdates.push({ payload, filter: { [col]: val } })
          return Promise.resolve({ data: null, error: null })
        }),
      }
      return builder
    }),
  } as unknown as SupabaseClient

  return { client, bucket, removed, profileUpdates }
}

beforeEach(() => { vi.clearAllMocks() })

describe('getIdentityRetentionDays', () => {
  const original = process.env.IDENTITY_RETENTION_DAYS
  afterEach(() => {
    if (original === undefined) delete process.env.IDENTITY_RETENTION_DAYS
    else process.env.IDENTITY_RETENTION_DAYS = original
  })

  it('defaults to 365 when unset', () => {
    delete process.env.IDENTITY_RETENTION_DAYS
    expect(getIdentityRetentionDays()).toBe(365)
  })

  it('reads a valid override', () => {
    process.env.IDENTITY_RETENTION_DAYS = '30'
    expect(getIdentityRetentionDays()).toBe(30)
  })

  it('supports 0 (immediate purge)', () => {
    process.env.IDENTITY_RETENTION_DAYS = '0'
    expect(getIdentityRetentionDays()).toBe(0)
  })

  it('falls back to 365 on garbage / negative values', () => {
    process.env.IDENTITY_RETENTION_DAYS = 'abc'
    expect(getIdentityRetentionDays()).toBe(365)
    process.env.IDENTITY_RETENTION_DAYS = '-5'
    expect(getIdentityRetentionDays()).toBe(365)
  })
})

describe('purgeIdentityDocuments', () => {
  it('removes every listed file and nulls the profile identity columns', async () => {
    const { client, bucket, removed, profileUpdates } = buildFake({
      data: [{ name: 'id_doc.jpg' }, { name: 'id_selfie.jpg' }, { name: 'id_video.mp4' }],
      error: null,
    })

    const result = await purgeIdentityDocuments(client, 'user-7')

    expect(result).toEqual({ removed: 3 })
    expect(bucket.list).toHaveBeenCalledWith('user-7')
    // Files removed under the user's folder, fully prefixed.
    expect(removed).toEqual([[
      'user-7/id_doc.jpg',
      'user-7/id_selfie.jpg',
      'user-7/id_video.mp4',
    ]])
    // Profile columns nulled, scoped to the user's row.
    expect(profileUpdates).toHaveLength(1)
    expect(profileUpdates[0].payload).toEqual({
      identity_doc_url: null,
      identity_selfie_url: null,
      identity_video_url: null,
    })
    expect(profileUpdates[0].filter).toEqual({ id: 'user-7' })
  })

  it('is a no-op for an empty folder and does not throw', async () => {
    const { client, bucket, removed } = buildFake({ data: [], error: null })

    const result = await purgeIdentityDocuments(client, 'user-empty')

    expect(result).toEqual({ removed: 0 })
    expect(bucket.list).toHaveBeenCalledWith('user-empty')
    // Nothing to remove.
    expect(bucket.remove).not.toHaveBeenCalled()
    expect(removed).toEqual([])
  })

  it('handles a null list payload gracefully', async () => {
    const { client, bucket } = buildFake({ data: null, error: null })
    const result = await purgeIdentityDocuments(client, 'user-x')
    expect(result).toEqual({ removed: 0 })
    expect(bucket.remove).not.toHaveBeenCalled()
  })

  it('throws when the list call errors', async () => {
    const { client } = buildFake({ data: null, error: { message: 'boom' } })
    await expect(purgeIdentityDocuments(client, 'user-7')).rejects.toThrow(/boom/)
  })
})
