// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { persistDiditDecision, type DiditWebhookBody } from './sessions'

const HEX_KEY = '0'.repeat(64)

type FakeCfg = {
  existing?: { status: string } | null
  upsertError?: { message: string } | null
  profilesData?: unknown[]
  profilesError?: { message: string } | null
  postsError?: { message: string } | null
}

type Call = { table: string; op: string; payload: unknown }

function buildFake(cfg: FakeCfg = {}) {
  const calls: Call[] = []

  const terminal = (table: string, op: string) => {
    if (table === 'verification_sessions' && op === 'upsert') return { error: cfg.upsertError ?? null }
    if (table === 'profiles' && op === 'update') {
      return { data: cfg.profilesData ?? [{ id: 'user-1' }], error: cfg.profilesError ?? null }
    }
    if (table === 'posts' && op === 'update') return { error: cfg.postsError ?? null }
    return { data: null, error: null }
  }

  const make = (table: string) => {
    let op = 'select'
    let payload: unknown = null
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      update: vi.fn((p: unknown) => { op = 'update'; payload = p; return builder }),
      upsert: vi.fn((p: unknown) => { op = 'upsert'; payload = p; return builder }),
      insert: vi.fn((p: unknown) => { op = 'insert'; payload = p; return builder }),
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn(() => Promise.resolve({ data: cfg.existing ?? null, error: null })),
      then: (resolve: (v: unknown) => unknown) => {
        calls.push({ table, op, payload })
        return resolve(terminal(table, op))
      },
    }
    return builder
  }

  return {
    client: { from: vi.fn((t: string) => make(t)) } as unknown as SupabaseClient,
    calls,
  }
}

function body(extra: Partial<DiditWebhookBody> = {}): DiditWebhookBody {
  return {
    session_id: 'sess-1',
    status: 'Approved',
    vendor_data: 'user-1',
    workflow_id: 'wf-1',
    decision: { face_match: { score: 97 }, liveness: { score: 92 } },
    ...extra,
  }
}

function find(calls: Call[], table: string, op: string) {
  return calls.find((c) => c.table === table && c.op === op)
}

describe('didit/sessions · persistDiditDecision', () => {
  beforeEach(() => vi.stubEnv('DIDIT_PAYLOAD_KEY', HEX_KEY))
  afterEach(() => vi.unstubAllEnvs())

  it('Approved: upsert approved + cascade (identity_verified=true on profiles and posts)', async () => {
    const { client, calls } = buildFake()
    const r = await persistDiditDecision(client, body())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.internalStatus).toBe('approved')
      expect(r.data.applied).toBe(true)
      expect(r.data.stale).toBe(false)
    }
    const upsert = find(calls, 'verification_sessions', 'upsert')!
    expect((upsert.payload as Record<string, unknown>).status).toBe('approved')
    expect((upsert.payload as Record<string, unknown>).face_match_score).toBe(97)
    // encrypted payload, not in the clear
    expect(String((upsert.payload as Record<string, unknown>).decision_payload_encrypted)).toMatch(/^v1\./)
    const profUpdate = find(calls, 'profiles', 'update')!
    expect((profUpdate.payload as Record<string, unknown>).identity_verified).toBe(true)
    expect(find(calls, 'posts', 'update')).toBeTruthy()
  })

  it('Declined: rejectVerification (identity_verified=false) with the warning reason', async () => {
    const { client, calls } = buildFake()
    const r = await persistDiditDecision(
      client,
      body({ status: 'Declined', decision: { warnings: [{ risk: 'FACE_MISMATCH' }] } }),
    )
    expect(r.ok).toBe(true)
    const upsert = find(calls, 'verification_sessions', 'upsert')!
    expect((upsert.payload as Record<string, unknown>).status).toBe('declined')
    expect((upsert.payload as Record<string, unknown>).decline_reason).toBe('FACE_MISMATCH')
    const profUpdate = find(calls, 'profiles', 'update')!
    expect((profUpdate.payload as Record<string, unknown>).identity_verified).toBe(false)
    expect((profUpdate.payload as Record<string, unknown>).verification_note).toContain('FACE_MISMATCH')
  })

  it('In Review: marks the profile pending (without touching identity_verified)', async () => {
    const { client, calls } = buildFake()
    const r = await persistDiditDecision(client, body({ status: 'In Review' }))
    expect(r.ok).toBe(true)
    const profUpdate = find(calls, 'profiles', 'update')!
    expect((profUpdate.payload as Record<string, unknown>).verification_status).toBe('pending')
    expect((profUpdate.payload as Record<string, unknown>).identity_verified).toBeUndefined()
  })

  it('out-of-order: an In Progress webhook does NOT downgrade an already-approved session', async () => {
    const { client, calls } = buildFake({ existing: { status: 'approved' } })
    const r = await persistDiditDecision(client, body({ status: 'In Progress' }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.stale).toBe(true)
      expect(r.data.applied).toBe(false)
    }
    // The upsert keeps 'approved', does not touch the profile
    const upsert = find(calls, 'verification_sessions', 'upsert')!
    expect((upsert.payload as Record<string, unknown>).status).toBe('approved')
    expect(find(calls, 'profiles', 'update')).toBeUndefined()
  })

  it('new in_progress: upsert without a profile change', async () => {
    const { client, calls } = buildFake()
    const r = await persistDiditDecision(client, body({ status: 'In Progress' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.applied).toBe(false)
    expect(find(calls, 'profiles', 'update')).toBeUndefined()
  })

  it('without session_id → error', async () => {
    const { client } = buildFake()
    const r = await persistDiditDecision(client, body({ session_id: '' }))
    expect(r.ok).toBe(false)
  })

  it('without vendor_data: persists the session but does not apply to the profile', async () => {
    const { client, calls } = buildFake()
    const r = await persistDiditDecision(client, body({ vendor_data: null }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.userId).toBeNull()
      expect(r.data.applied).toBe(false)
    }
    expect(find(calls, 'verification_sessions', 'upsert')).toBeTruthy()
    expect(find(calls, 'profiles', 'update')).toBeUndefined()
  })

  it('upsert error → propagates', async () => {
    const { client } = buildFake({ upsertError: { message: 'db down' } })
    const r = await persistDiditDecision(client, body())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('db down')
  })

  // ── PR-1: creators sync wiring ─────────────────────────────────────────
  it('stale (late webhook) → does NOT upsert creators (never degrades a verified row)', async () => {
    // Already-approved session + a late In Progress event = stale. The key
    // guarantee: a tardy webhook must not touch the creators verification.
    const { client, calls } = buildFake({ existing: { status: 'approved' } })
    const r = await persistDiditDecision(client, body({ status: 'In Progress' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.stale).toBe(true)
    expect(find(calls, 'creators', 'upsert')).toBeUndefined()
  })

  it('Approved + adult DOB → upserts creators with age_verified=true / kyc_status=verified', async () => {
    const { client, calls } = buildFake()
    const r = await persistDiditDecision(
      client,
      body({
        status: 'Approved',
        decision: {
          face_match: { score: 97 },
          liveness: { score: 92 },
          id_verification: { date_of_birth: '1990-01-01' },
        },
      }),
    )
    expect(r.ok).toBe(true)
    const creators = find(calls, 'creators', 'upsert')!
    expect(creators).toBeTruthy()
    const p = creators.payload as Record<string, unknown>
    expect(p).toMatchObject({ user_id: 'user-1', kyc_status: 'verified', age_verified: true })
    expect(typeof p.age_verified_at).toBe('string')
  })

  // (c) simple-signature-only → the verdict is NOT applied. That gate lives at
  // the ROUTE layer (src/app/api/webhooks/didit/route.ts): it returns a 200
  // no-op for verdict.method === 'simple' and never calls persistDiditDecision,
  // because the 'simple' signature doesn't cover vendor_data / decision / DOB.
  // persistDiditDecision itself is signature-agnostic (it only runs once the
  // route has authenticated a full-body signature), so there's nothing to assert
  // here — the invariant is documented + enforced upstream of this function.
})
