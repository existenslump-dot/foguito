// @vitest-environment node
/**
 * getCreatorEarningsBalance (PR-8) — SUM(credit)−SUM(debit) sobre
 * `creator:<id>:earnings`, clamp ≥0, fail-safe a 0. Acota la query a la cuenta de
 * la creadora dada.
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCreatorEarningsBalance } from './index'

const CREATOR = '11111111-1111-1111-1111-111111111111'

/** Cliente fake: `.from().select().eq()` resuelve a { data, error }. Registra el eq. */
function fakeClient(
  result: { data: unknown; error: unknown },
  eqSpy = vi.fn((..._a: unknown[]) => Promise.resolve(result)),
): SupabaseClient {
  return {
    from: vi.fn((..._f: unknown[]) => ({
      select: vi.fn((..._s: unknown[]) => ({ eq: eqSpy })),
    })),
  } as unknown as SupabaseClient
}

describe('getCreatorEarningsBalance', () => {
  it('suma créditos y resta débitos', async () => {
    const client = fakeClient({
      data: [
        { direction: 'credit', amount: 800 },
        { direction: 'credit', amount: 200 },
        { direction: 'debit', amount: 300 },
      ],
      error: null,
    })
    expect(await getCreatorEarningsBalance(client, CREATOR)).toBe(700)
  })

  it('acota la query a la cuenta creator:<id>:earnings', async () => {
    const eqSpy = vi.fn((..._a: unknown[]) => Promise.resolve({ data: [], error: null }))
    const client = fakeClient({ data: [], error: null }, eqSpy)
    await getCreatorEarningsBalance(client, CREATOR)
    expect(eqSpy).toHaveBeenCalledWith('account', `creator:${CREATOR}:earnings`)
  })

  it('clamp ≥0: un neto negativo devuelve 0 (fail-safe, nunca miente hacia arriba)', async () => {
    const client = fakeClient({
      data: [
        { direction: 'credit', amount: 100 },
        { direction: 'debit', amount: 500 },
      ],
      error: null,
    })
    expect(await getCreatorEarningsBalance(client, CREATOR)).toBe(0)
  })

  it('ignora montos no finitos / no numéricos', async () => {
    const client = fakeClient({
      data: [
        { direction: 'credit', amount: 500 },
        { direction: 'credit', amount: null },
        { direction: 'credit', amount: 'x' },
      ],
      error: null,
    })
    expect(await getCreatorEarningsBalance(client, CREATOR)).toBe(500)
  })

  it('error de la query → 0', async () => {
    const client = fakeClient({ data: null, error: { message: 'boom' } })
    expect(await getCreatorEarningsBalance(client, CREATOR)).toBe(0)
  })

  it('sin filas → 0', async () => {
    const client = fakeClient({ data: [], error: null })
    expect(await getCreatorEarningsBalance(client, CREATOR)).toBe(0)
  })
})
