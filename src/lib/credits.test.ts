// @vitest-environment node
/**
 * Tests de `getFoguitoBalance` + los wrappers de RPC (PR-6).
 *
 * getFoguitoBalance: balance = SUM(credit) − SUM(debit) sobre las filas del fan.
 * Fail-safe a CERO ante error/vacío; nunca negativo ni NaN hacia afuera.
 * Los wrappers: llaman a la RPC correcta con los nombres de arg EXACTOS.
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getFoguitoBalance,
  unlockPpv,
  subscribeCreator,
  creditFoguitos,
} from './credits'

type LedgerRow = { direction: 'credit' | 'debit'; amount: number | null }

/** Cliente falso: from().select().eq() resuelve a { data, error }. */
function fakeLedgerClient(result: {
  data: LedgerRow[] | null
  error: { message: string } | null
}): SupabaseClient {
  const eqSpy = vi.fn((..._a: unknown[]) => Promise.resolve(result))
  return {
    from: vi.fn((..._a: unknown[]) => ({
      select: vi.fn((..._b: unknown[]) => ({ eq: eqSpy })),
    })),
  } as unknown as SupabaseClient
}

describe('getFoguitoBalance', () => {
  it('suma credit − debit correctamente', async () => {
    const client = fakeLedgerClient({
      data: [
        { direction: 'credit', amount: 1000 },
        { direction: 'debit', amount: 300 },
        { direction: 'credit', amount: 50 },
        { direction: 'debit', amount: 200 },
      ],
      error: null,
    })
    // 1000 + 50 − 300 − 200 = 550
    expect(await getFoguitoBalance(client, 'fan-1')).toBe(550)
  })

  it('devuelve 0 con el ledger vacío', async () => {
    const client = fakeLedgerClient({ data: [], error: null })
    expect(await getFoguitoBalance(client, 'fan-1')).toBe(0)
  })

  it('devuelve 0 ante error de la consulta (fail-safe)', async () => {
    const client = fakeLedgerClient({ data: null, error: { message: 'rls denied' } })
    expect(await getFoguitoBalance(client, 'fan-1')).toBe(0)
  })

  it('devuelve 0 (no negativo) si los débitos superan a los créditos', async () => {
    const client = fakeLedgerClient({
      data: [
        { direction: 'credit', amount: 100 },
        { direction: 'debit', amount: 500 },
      ],
      error: null,
    })
    expect(await getFoguitoBalance(client, 'fan-1')).toBe(0)
  })

  it('ignora montos no finitos / nulos sin devolver NaN', async () => {
    const client = fakeLedgerClient({
      data: [
        { direction: 'credit', amount: 100 },
        { direction: 'credit', amount: null },
        { direction: 'debit', amount: 40 },
      ],
      error: null,
    })
    expect(await getFoguitoBalance(client, 'fan-1')).toBe(60)
  })

  it('devuelve 0 si el cliente tira (fail-safe)', async () => {
    const client = {
      from: () => {
        throw new Error('boom')
      },
    } as unknown as SupabaseClient
    expect(await getFoguitoBalance(client, 'fan-1')).toBe(0)
  })
})

/** Admin falso que captura el nombre de la RPC y sus args. */
function fakeAdmin(returnValue: { data: unknown; error: unknown }) {
  const rpcSpy = vi.fn((..._a: unknown[]) => Promise.resolve(returnValue))
  const admin = { rpc: rpcSpy } as unknown as SupabaseClient
  return { admin, rpcSpy }
}

describe('wrappers de RPC — nombres de arg exactos', () => {
  it('unlockPpv llama unlock_ppv_content con p_fan/p_content', async () => {
    const { admin, rpcSpy } = fakeAdmin({ data: 'ok', error: null })
    const res = await unlockPpv(admin, 'fan-1', 'content-1')
    expect(rpcSpy).toHaveBeenCalledWith('unlock_ppv_content', {
      p_fan: 'fan-1',
      p_content: 'content-1',
    })
    expect(res.data).toBe('ok')
    expect(res.error).toBeNull()
  })

  it('subscribeCreator llama subscribe_creator con p_fan/p_creator', async () => {
    const { admin, rpcSpy } = fakeAdmin({ data: 'already_active', error: null })
    const res = await subscribeCreator(admin, 'fan-1', 'creator-1')
    expect(rpcSpy).toHaveBeenCalledWith('subscribe_creator', {
      p_fan: 'fan-1',
      p_creator: 'creator-1',
    })
    expect(res.data).toBe('already_active')
  })

  it('creditFoguitos llama credit_foguitos con p_user/p_amount/p_reason/p_idempotency_key', async () => {
    const { admin, rpcSpy } = fakeAdmin({ data: 'ok', error: null })
    const res = await creditFoguitos(admin, 'user-1', 500, 'admin_topup', 'idem-1')
    expect(rpcSpy).toHaveBeenCalledWith('credit_foguitos', {
      p_user: 'user-1',
      p_amount: 500,
      p_reason: 'admin_topup',
      p_idempotency_key: 'idem-1',
    })
    expect(res.data).toBe('ok')
  })

  it('propaga el error de la RPC sin lanzarlo', async () => {
    const { admin } = fakeAdmin({ data: null, error: { message: 'db down' } })
    const res = await unlockPpv(admin, 'fan-1', 'content-1')
    expect(res.data).toBeNull()
    expect(res.error).toEqual({ message: 'db down' })
  })
})
