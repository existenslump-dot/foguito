// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  syncCreatorFromDidit,
  ensureCreatorRow,
  getCreatorVerification,
  isPublishEligible,
} from './creators'
import type { AgeResult } from './didit/age'

type Call = { table: string; op: string; payload: unknown; onConflict?: unknown }

function buildFake(cfg: { upsertError?: { message: string } | null; selectData?: unknown } = {}) {
  const calls: Call[] = []
  const make = (table: string) => {
    let op = 'select'
    let payload: unknown = null
    let onConflict: unknown = undefined
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      upsert: vi.fn((p: unknown, opts?: { onConflict?: string }) => {
        op = 'upsert'
        payload = p
        onConflict = opts?.onConflict
        return builder
      }),
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn(() =>
        Promise.resolve({ data: cfg.selectData ?? null, error: null }),
      ),
      then: (resolve: (v: unknown) => unknown) => {
        calls.push({ table, op, payload, onConflict })
        return resolve({ error: cfg.upsertError ?? null, data: null })
      },
    }
    return builder
  }
  return { client: { from: vi.fn((t: string) => make(t)) } as unknown as SupabaseClient, calls }
}

const age = (over: Partial<AgeResult> = {}): AgeResult => ({
  dob: '2000-01-01',
  age: 25,
  ageVerified: true,
  reason: 'ok',
  ...over,
})

const upsertCall = (calls: Call[]) => calls.find((c) => c.table === 'creators' && c.op === 'upsert')

describe('creators · syncCreatorFromDidit', () => {
  it("approved + age-verified → creators verified/age_verified=true + session id", async () => {
    const { client, calls } = buildFake()
    const r = await syncCreatorFromDidit(client, 'u1', {
      effectiveStatus: 'approved',
      ageResult: age(),
      sessionId: 'sess-9',
    })
    expect(r).toMatchObject({ applied: true, kyc_status: 'verified', age_verified: true, reason: 'ok' })
    const call = upsertCall(calls)!
    expect(call.onConflict).toBe('user_id')
    const p = call.payload as Record<string, unknown>
    expect(p).toMatchObject({
      user_id: 'u1',
      kyc_status: 'verified',
      age_verified: true,
      didit_session_id: 'sess-9',
    })
    expect(typeof p.age_verified_at).toBe('string')
  })

  it('approved but below_18 → hard reject (rejected/age_verified=false)', async () => {
    const { client, calls } = buildFake()
    const r = await syncCreatorFromDidit(client, 'u1', {
      effectiveStatus: 'approved',
      ageResult: age({ ageVerified: false, age: 17, reason: 'below_18' }),
      sessionId: 'sess-9',
    })
    expect(r).toMatchObject({ applied: true, kyc_status: 'rejected', age_verified: false })
    const p = upsertCall(calls)!.payload as Record<string, unknown>
    expect(p).toMatchObject({ user_id: 'u1', kyc_status: 'rejected', age_verified: false })
    expect(p.age_verified_at).toBeUndefined()
  })

  it('approved but dob_missing → pending (fail-closed, does not publish)', async () => {
    const { client, calls } = buildFake()
    const r = await syncCreatorFromDidit(client, 'u1', {
      effectiveStatus: 'approved',
      ageResult: age({ ageVerified: false, age: null, dob: null, reason: 'dob_missing' }),
    })
    expect(r).toMatchObject({ applied: true, kyc_status: 'pending', age_verified: false })
    const p = upsertCall(calls)!.payload as Record<string, unknown>
    expect(p).toMatchObject({ user_id: 'u1', kyc_status: 'pending', age_verified: false })
  })

  it('approved but dob_invalid → pending (fail-closed)', async () => {
    const { client, calls } = buildFake()
    const r = await syncCreatorFromDidit(client, 'u1', {
      effectiveStatus: 'approved',
      ageResult: age({ ageVerified: false, age: null, dob: null, reason: 'dob_invalid' }),
    })
    expect(r.kyc_status).toBe('pending')
    const p = upsertCall(calls)!.payload as Record<string, unknown>
    expect(p.kyc_status).toBe('pending')
  })

  it('declined → rejected', async () => {
    const { client, calls } = buildFake()
    const r = await syncCreatorFromDidit(client, 'u1', {
      effectiveStatus: 'declined',
      ageResult: age(),
    })
    expect(r).toMatchObject({ applied: true, kyc_status: 'rejected', age_verified: false })
    const p = upsertCall(calls)!.payload as Record<string, unknown>
    expect(p).toMatchObject({ kyc_status: 'rejected', age_verified: false })
  })

  it('in_review → pending (does not touch age_verified)', async () => {
    const { client, calls } = buildFake()
    const r = await syncCreatorFromDidit(client, 'u1', {
      effectiveStatus: 'in_review',
      ageResult: age(),
    })
    expect(r).toMatchObject({ applied: true, kyc_status: 'pending' })
    const p = upsertCall(calls)!.payload as Record<string, unknown>
    expect(p).toEqual({ user_id: 'u1', kyc_status: 'pending' })
  })

  it('non-terminal status (in_progress) → no-op, no upsert', async () => {
    const { client, calls } = buildFake()
    const r = await syncCreatorFromDidit(client, 'u1', {
      effectiveStatus: 'in_progress',
      ageResult: age(),
    })
    expect(r.applied).toBe(false)
    expect(upsertCall(calls)).toBeUndefined()
  })

  it('upsert error → non-fatal, applied=false', async () => {
    const { client } = buildFake({ upsertError: { message: 'db down' } })
    const r = await syncCreatorFromDidit(client, 'u1', {
      effectiveStatus: 'approved',
      ageResult: age(),
    })
    expect(r.applied).toBe(false)
    expect(r.kyc_status).toBe('verified')
  })
})

describe('creators · ensureCreatorRow', () => {
  it('upserts user_id + didit_session_id, never forces verified', async () => {
    const { client, calls } = buildFake()
    const r = await ensureCreatorRow(client, 'u1', 'sess-1')
    expect(r.ok).toBe(true)
    const call = upsertCall(calls)!
    expect(call.onConflict).toBe('user_id')
    const p = call.payload as Record<string, unknown>
    expect(p).toEqual({ user_id: 'u1', didit_session_id: 'sess-1' })
    expect(p.kyc_status).toBeUndefined()
  })

  it('upserts just user_id when no session id', async () => {
    const { client, calls } = buildFake()
    await ensureCreatorRow(client, 'u1')
    expect((upsertCall(calls)!.payload as Record<string, unknown>)).toEqual({ user_id: 'u1' })
  })

  it('error → non-fatal ok:false', async () => {
    const { client } = buildFake({ upsertError: { message: 'boom' } })
    const r = await ensureCreatorRow(client, 'u1')
    expect(r.ok).toBe(false)
  })
})

describe('creators · getCreatorVerification', () => {
  it('returns the row when present', async () => {
    const { client } = buildFake({ selectData: { kyc_status: 'verified', age_verified: true } })
    const r = await getCreatorVerification(client, 'u1')
    expect(r).toEqual({ kyc_status: 'verified', age_verified: true })
  })

  it('returns null when absent', async () => {
    const { client } = buildFake()
    expect(await getCreatorVerification(client, 'u1')).toBeNull()
  })
})

describe('creators · isPublishEligible', () => {
  it('true only for verified + age_verified', () => {
    expect(isPublishEligible({ kyc_status: 'verified', age_verified: true })).toBe(true)
  })
  it('false when not verified or not age-verified or null', () => {
    expect(isPublishEligible({ kyc_status: 'pending', age_verified: true })).toBe(false)
    expect(isPublishEligible({ kyc_status: 'verified', age_verified: false })).toBe(false)
    expect(isPublishEligible(null)).toBe(false)
    expect(isPublishEligible(undefined)).toBe(false)
  })
})
