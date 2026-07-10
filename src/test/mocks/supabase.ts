/**
 * Chainable Supabase client mock for Vitest.
 *
 * The real client uses a builder pattern: `supabase.from('t').select('*').eq('x', 1).single()`.
 * Each call returns another builder. For tests, we return a Proxy that (a) logs
 * the call chain for assertion, and (b) resolves to `{ data, error }` once
 * awaited — matching the real client's terminal behaviour.
 *
 * Usage:
 *   import { createSupabaseMock } from '@/test/mocks/supabase'
 *   const supabase = createSupabaseMock({
 *     posts: [{ id: '1', title: 'Stella', status: 'pending' }],
 *     profiles: [{ id: 'u1', is_admin: true }],
 *   })
 *
 * Every query against `posts` → returns the posts array.
 * Every query against `profiles` → returns the profiles array.
 *
 * Not a perfect emulator — just enough to let components render without
 * throwing. Refine per-test if a case needs exact filter semantics.
 */

import { vi } from 'vitest'

export interface SupabaseMockData {
  [table: string]: unknown[] | Record<string, unknown>
}

export function createSupabaseMock(tables: SupabaseMockData = {}) {
  const from = vi.fn((table: string) => {
    const tableData = tables[table]
    const rows = Array.isArray(tableData) ? tableData : tableData ? [tableData] : []

    const builder: Record<string, unknown> = {}

    // Chain-returning methods — all just return the builder so caller can
    // keep chaining. The actual data resolves via `then` below.
    const chainMethods = [
      'select', 'insert', 'update', 'upsert', 'delete',
      'eq', 'neq', 'lt', 'gt', 'lte', 'gte', 'like', 'ilike',
      'in', 'is', 'contains', 'containedBy', 'filter', 'match',
      'or', 'and', 'not', 'order', 'limit', 'range', 'returns',
      'overlaps', 'textSearch',
    ]
    for (const method of chainMethods) {
      builder[method] = vi.fn(() => builder)
    }

    // Terminal methods resolve the query. `single()` + `maybeSingle()` return
    // one row; everything else returns the array.
    builder.single = vi.fn(() => Promise.resolve({ data: rows[0] ?? null, error: null }))
    builder.maybeSingle = vi.fn(() => Promise.resolve({ data: rows[0] ?? null, error: null }))

    // Awaiting the builder directly (no .single()) resolves to the full array.
    builder.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
      resolve({ data: rows, error: null })

    return builder
  })

  // `user` is typed as nullable so tests can vi.fn(() => null) without a
  // per-call cast. The production Supabase types also allow null here —
  // we just happened to narrow it in the mock, which meant every "no
  // session" test had to fight TS. One central cast keeps callers clean.
  type MockUser = { id: string; email: string } | null
  const defaultUser: MockUser = { id: 'test-user-id', email: 'admin@example.com' }
  const auth = {
    getUser: vi.fn<() => Promise<{ data: { user: MockUser }; error: null }>>(() => Promise.resolve({
      data: { user: defaultUser },
      error: null,
    })),
    getSession: vi.fn(() => Promise.resolve({
      data: { session: null },
      error: null,
    })),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
  }

  const storage = {
    from: vi.fn(() => ({
      upload: vi.fn(() => Promise.resolve({ data: { path: 'mock' }, error: null })),
      getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://mock' } })),
      remove: vi.fn(() => Promise.resolve({ data: [], error: null })),
    })),
  }

  return { from, auth, storage }
}
