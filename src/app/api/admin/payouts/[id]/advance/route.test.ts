// @vitest-environment node
/**
 * Contract tests de /api/admin/payouts/[id]/advance (PR-8, money-out regulado).
 *
 *   gate admin propagado (no-admin → 403/401) · TOTP fresca exigida
 *   (requireFreshTotp:true) · approve/fail/hold → advance_payout(estado) ·
 *   `send` con sanciones review → HELD, NO sent (VASP no se llama) · throw del VASP
 *   en send → FAILED + 502 · `send` feliz → sanciones clear + Travel Rule + VASP +
 *   advance_payout('sent', refs) · doble-send sobre un payout no-approved NO llama
 *   al VASP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const PAYOUT_ID = '33333333-3333-3333-3333-333333333333'
const CREATOR = '11111111-1111-1111-1111-111111111111'

// ── admin gate (captura args para verificar requireFreshTotp) ────────
let gate: { ok: true; userId: string } | { ok: false; response: NextResponse } = {
  ok: true,
  userId: 'admin-1',
}
const requireAdminSpy = vi.fn((..._a: unknown[]) => Promise.resolve(gate))
vi.mock('@/lib/clients/require-admin', () => ({
  requireAdmin: (...a: unknown[]) => requireAdminSpy(...a),
}))

// ── service-role: from().select().eq().maybeSingle() + rpc ───────────
let payoutRow:
  | { id: string; creator_id: string; amount_usdt: number; amount_foguitos: number | null; status: string; tax_withholding: number | null }
  | null = {
  id: PAYOUT_ID,
  creator_id: CREATOR,
  amount_usdt: 5,
  amount_foguitos: 500,
  status: 'approved',
  tax_withholding: null,
}
let creatorRow: { user_id: string; pseudonym: string | null; country: string | null } | null = {
  user_id: CREATOR,
  pseudonym: 'Ada',
  country: 'AR',
}
let rpcResult: { data: unknown; error: unknown } = { data: 'ok', error: null }
const rpcSpy = vi.fn((..._a: unknown[]) => Promise.resolve(rpcResult))

function makeChain(row: unknown) {
  const chain: Record<string, unknown> = {
    select: vi.fn((..._a: unknown[]) => chain),
    eq: vi.fn((..._a: unknown[]) => chain),
    maybeSingle: vi.fn((..._a: unknown[]) => Promise.resolve({ data: row, error: null })),
  }
  return chain
}
const fromSpy = vi.fn((table: string) =>
  makeChain(table === 'payouts' ? payoutRow : table === 'creators' ? creatorRow : null),
)
vi.mock('@/lib/clients/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: fromSpy, rpc: rpcSpy }),
}))

// ── providers ────────────────────────────────────────────────────────
let sanctionsResult: { status: 'clear' | 'review' | 'hit'; ref: string } = { status: 'clear', ref: 'S-1' }
let sanctionsThrows = false
const screenSpy = vi.fn((..._a: unknown[]) =>
  sanctionsThrows ? Promise.reject(new Error('sanctions boom')) : Promise.resolve(sanctionsResult),
)
let sendThrows = false
const sendSpy = vi.fn((..._a: unknown[]) =>
  sendThrows ? Promise.reject(new Error('vasp unwired')) : Promise.resolve({ vaspTxId: 'VASP-1' }),
)
vi.mock('@/lib/payouts/provider', () => ({
  getSanctionsProvider: () => ({ screen: screenSpy }),
  getPayoutProvider: () => ({ sendPayout: sendSpy }),
}))

// ── travel rule ──────────────────────────────────────────────────────
let trThrows = false
const submitTRSpy = vi.fn((..._a: unknown[]) =>
  trThrows ? Promise.reject(new Error('tr unwired')) : Promise.resolve({ ref: 'TR-1' }),
)
vi.mock('@/lib/payouts/provider/travel-rule', () => ({
  assembleTravelRuleInfo: (..._a: unknown[]) => ({ payoutRef: PAYOUT_ID }),
  submitTravelRule: (...a: unknown[]) => submitTRSpy(...a),
}))

const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('@/lib/audit', () => ({ recordAudit: (...a: unknown[]) => auditSpy(...a) }))

import { POST } from './route'

function req(action: unknown) {
  return new Request('https://example.com/api/admin/payouts/x/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  }) as never
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

/** Args de la ÚLTIMA llamada a advance_payout (el `send` feliz hace 2: el claim
 *  'sending' y luego 'sent' — nos interesa la transición final). */
function advanceArgs(): Record<string, unknown> | undefined {
  const calls = rpcSpy.mock.calls.filter((c) => c[0] === 'advance_payout')
  return calls[calls.length - 1]?.[1] as Record<string, unknown> | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  gate = { ok: true, userId: 'admin-1' }
  payoutRow = {
    id: PAYOUT_ID,
    creator_id: CREATOR,
    amount_usdt: 5,
    amount_foguitos: 500,
    status: 'approved',
    tax_withholding: null,
  }
  creatorRow = { user_id: CREATOR, pseudonym: 'Ada', country: 'AR' }
  rpcResult = { data: 'ok', error: null }
  sanctionsResult = { status: 'clear', ref: 'S-1' }
  sanctionsThrows = false
  sendThrows = false
  trThrows = false
})

describe('POST /api/admin/payouts/[id]/advance', () => {
  it('propaga el gate admin (no-admin → 403, nada se llama)', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    const res = await POST(req('approve'), ctx(PAYOUT_ID))
    expect(res.status).toBe(403)
    expect(rpcSpy).not.toHaveBeenCalled()
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('401 cuando requireAdmin no autentica', async () => {
    gate = { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
    const res = await POST(req('approve'), ctx(PAYOUT_ID))
    expect(res.status).toBe(401)
  })

  it('exige TOTP enrolada (fail-closed) + fresca', async () => {
    await POST(req('approve'), ctx(PAYOUT_ID))
    expect(requireAdminSpy).toHaveBeenCalledWith(expect.anything(), {
      requireFreshTotp: true,
      requireTotpEnrolled: true,
    })
  })

  it('400 con id no-UUID', async () => {
    const res = await POST(req('approve'), ctx('nope'))
    expect(res.status).toBe(400)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('400 con action inválida', async () => {
    const res = await POST(req('teleport'), ctx(PAYOUT_ID))
    expect(res.status).toBe(400)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('approve → advance_payout("approved") → 200', async () => {
    const res = await POST(req('approve'), ctx(PAYOUT_ID))
    expect(res.status).toBe(200)
    expect(advanceArgs()).toMatchObject({ p_payout: PAYOUT_ID, p_new_status: 'approved' })
    expect(auditSpy).toHaveBeenCalled()
  })

  it('fail → advance_payout("failed") → 200', async () => {
    const res = await POST(req('fail'), ctx(PAYOUT_ID))
    expect(res.status).toBe(200)
    expect(advanceArgs()).toMatchObject({ p_new_status: 'failed' })
  })

  it('hold → advance_payout("held") → 200', async () => {
    const res = await POST(req('hold'), ctx(PAYOUT_ID))
    expect(res.status).toBe(200)
    expect(advanceArgs()).toMatchObject({ p_new_status: 'held' })
  })

  it('send feliz → sanciones clear + Travel Rule + CLAIM(sending) + VASP + advance("sent")', async () => {
    const res = await POST(req('send'), ctx(PAYOUT_ID))
    expect(res.status).toBe(200)
    expect(screenSpy).toHaveBeenCalled()
    expect(submitTRSpy).toHaveBeenCalled()
    expect(sendSpy).toHaveBeenCalled()
    // Claim atómico approved→sending ANTES del VASP (F1), estampando los refs (F2).
    const claim = rpcSpy.mock.calls.find(
      (c) => c[0] === 'advance_payout' && (c[1] as Record<string, unknown>).p_new_status === 'sending',
    )?.[1] as Record<string, unknown> | undefined
    expect(claim).toMatchObject({ p_new_status: 'sending', p_travel_rule_ref: 'TR-1', p_sanctions_ref: 'S-1' })
    // Y luego 'sent' con el vaspTxId.
    expect(advanceArgs()).toMatchObject({
      p_payout: PAYOUT_ID,
      p_new_status: 'sent',
      p_vasp_tx_id: 'VASP-1',
    })
  })

  it('send: si el CLAIM lo pierde (bad_transition) NO se llama al VASP', async () => {
    // El claim approved→sending devuelve bad_transition (otro request ganó) → abort.
    rpcResult = { data: 'bad_transition', error: null }
    const res = await POST(req('send'), ctx(PAYOUT_ID))
    expect(res.status).toBe(409)
    expect(screenSpy).toHaveBeenCalled() // screening/TR corren antes del claim
    expect(sendSpy).not.toHaveBeenCalled() // pero el VASP NO
  })

  it('send con sanciones review → HELD, NO sent (VASP + Travel Rule NO se llaman)', async () => {
    sanctionsResult = { status: 'review', ref: 'S-REV' }
    const res = await POST(req('send'), ctx(PAYOUT_ID))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'held' })
    expect(submitTRSpy).not.toHaveBeenCalled()
    expect(sendSpy).not.toHaveBeenCalled()
    expect(advanceArgs()).toMatchObject({ p_new_status: 'held' })
  })

  it('send con throw del VASP → FAILED + 502 (nunca sent)', async () => {
    sendThrows = true
    const res = await POST(req('send'), ctx(PAYOUT_ID))
    expect(res.status).toBe(502)
    expect(advanceArgs()).toMatchObject({ p_new_status: 'failed' })
    // NUNCA se intentó marcar 'sent'.
    expect(rpcSpy.mock.calls.every((c) => (c[1] as Record<string, unknown>).p_new_status !== 'sent')).toBe(true)
  })

  it('send con throw del Travel Rule → HELD + 502 (VASP no se llama)', async () => {
    trThrows = true
    const res = await POST(req('send'), ctx(PAYOUT_ID))
    expect(res.status).toBe(502)
    expect(sendSpy).not.toHaveBeenCalled()
    expect(advanceArgs()).toMatchObject({ p_new_status: 'held' })
  })

  it('send con throw del screening de sanciones → HELD + 502 (VASP no se llama)', async () => {
    sanctionsThrows = true
    const res = await POST(req('send'), ctx(PAYOUT_ID))
    expect(res.status).toBe(502)
    expect(sendSpy).not.toHaveBeenCalled()
    expect(advanceArgs()).toMatchObject({ p_new_status: 'held' })
  })

  it('send sobre un payout en "sending" (claim de OTRO request) → 409, NO toca VASP ni RPC', async () => {
    payoutRow = { ...payoutRow!, status: 'sending' }
    const res = await POST(req('send'), ctx(PAYOUT_ID))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'in_progress' })
    expect(sendSpy).not.toHaveBeenCalled()
    expect(screenSpy).not.toHaveBeenCalled()
    // No se avanza la máquina desde acá (evita marcar 'sent' un payout mid-flight).
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('send sobre un payout ya "sent" → 200 already, idempotente, sin VASP', async () => {
    payoutRow = { ...payoutRow!, status: 'sent' }
    const res = await POST(req('send'), ctx(PAYOUT_ID))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'already' })
    expect(sendSpy).not.toHaveBeenCalled()
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('send: payout inexistente → 404', async () => {
    payoutRow = null
    const res = await POST(req('send'), ctx(PAYOUT_ID))
    expect(res.status).toBe(404)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('mapeo de estados de la RPC: no_payout→404, bad_transition→409, not_eligible→403, invalid→400', async () => {
    for (const [data, code] of [
      ['no_payout', 404],
      ['bad_transition', 409],
      ['not_eligible', 403],
      ['invalid', 400],
    ] as const) {
      rpcResult = { data, error: null }
      const res = await POST(req('approve'), ctx(PAYOUT_ID))
      expect(res.status).toBe(code)
    }
  })

  it('error de la RPC en approve → 500', async () => {
    rpcResult = { data: null, error: { message: 'db down' } }
    const res = await POST(req('approve'), ctx(PAYOUT_ID))
    expect(res.status).toBe(500)
  })
})
