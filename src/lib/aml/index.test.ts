// @vitest-environment node
/**
 * Motor AML (PR-10) — `screenSubject`:
 *   - screenea vía el provider (un throw se PROPAGA — fail-closed en el caller)
 *   - deja el trail append-only en `sanctions_screenings` SIN PII (nunca legalName)
 *   - estampa la columna fast-path del sujeto (creators / profiles)
 *   - resiliente: un fallo del INSERT del trail NO pierde el update del status
 *   - un fallo del update SÍ tira (escritura load-bearing del gate)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── provider de sanciones (stub) ─────────────────────────────────────
let screenResult: { status: 'clear' | 'review' | 'hit'; ref: string } = { status: 'clear', ref: 'REF-1' }
let screenThrows = false
const screenSpy = vi.fn((..._a: unknown[]) =>
  screenThrows ? Promise.reject(new Error('provider boom')) : Promise.resolve(screenResult),
)
vi.mock('@/lib/payouts/provider', () => ({
  getSanctionsProvider: () => ({ name: 'stub', screen: screenSpy }),
}))

// ── vendor configurado? (gobierna el anti-downgrade) ─────────────────
// Default TRUE (vendor real): sin anti-downgrade, un clear/review baja un hit
// como cualquier verdict. Los tests de anti-downgrade lo ponen en false (stub).
let configured = true
vi.mock('@/lib/payouts/config', () => ({ isSanctionsConfigured: () => configured }))

import { screenSubject } from './index'

// ── fake service-role admin: insert / update().eq() / select().eq().maybeSingle() ──
let insertError: unknown = null
let updateError: unknown = null
let currentStatusRow: Record<string, unknown> | null = null
const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
const updates: Array<{ table: string; patch: Record<string, unknown>; col: string; val: unknown }> = []
function makeAdmin() {
  return {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row })
        return Promise.resolve({ error: insertError })
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: unknown) => {
          updates.push({ table, patch, col, val })
          return Promise.resolve({ error: updateError })
        },
      }),
      // Lectura del status persistido (anti-downgrade).
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: () => Promise.resolve({ data: currentStatusRow, error: null }),
        }),
      }),
    }),
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  screenResult = { status: 'clear', ref: 'REF-1' }
  screenThrows = false
  configured = true
  insertError = null
  updateError = null
  currentStatusRow = null
  inserts.length = 0
  updates.length = 0
})

describe('aml/screenSubject', () => {
  it('creator: screenea, deja trail y estampa creators.sanctions_status (keyed user_id)', async () => {
    const r = await screenSubject(makeAdmin(), {
      subjectType: 'creator',
      subjectId: 'creator-1',
      legalName: 'Ada Lovelace',
      country: 'AR',
    })
    // El provider recibió la superficie + el id (y la PII para el match del vendor).
    expect(screenSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: 'creator-1', subjectType: 'creator', legalName: 'Ada Lovelace' }),
    )
    // Trail append-only en sanctions_screenings.
    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe('sanctions_screenings')
    expect(inserts[0].row).toMatchObject({
      subject_type: 'creator',
      subject_id: 'creator-1',
      status: 'clear',
      provider: 'stub',
      ref: 'REF-1',
    })
    // Fast-path column.
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ table: 'creators', col: 'user_id', val: 'creator-1' })
    expect(updates[0].patch).toMatchObject({ sanctions_status: 'clear' })
    expect(updates[0].patch).toHaveProperty('sanctions_screened_at')
    expect(r).toEqual({ status: 'clear', ref: 'REF-1', provider: 'stub' })
  })

  it('consumer: estampa profiles.consumer_sanctions_status (keyed id)', async () => {
    screenResult = { status: 'hit', ref: 'REF-HIT' }
    const r = await screenSubject(makeAdmin(), { subjectType: 'consumer', subjectId: 'fan-1' })
    expect(inserts[0].row).toMatchObject({ subject_type: 'consumer', subject_id: 'fan-1', status: 'hit' })
    expect(updates[0]).toMatchObject({ table: 'profiles', col: 'id', val: 'fan-1' })
    expect(updates[0].patch).toMatchObject({ consumer_sanctions_status: 'hit' })
    expect(updates[0].patch).toHaveProperty('consumer_screened_at')
    expect(r.status).toBe('hit')
  })

  it('payout: comparte beneficiaria con la creadora → estampa creators (keyed user_id)', async () => {
    await screenSubject(makeAdmin(), { subjectType: 'payout', subjectId: 'benef-1' })
    expect(inserts[0].row).toMatchObject({ subject_type: 'payout', subject_id: 'benef-1' })
    expect(updates[0]).toMatchObject({ table: 'creators', col: 'user_id', val: 'benef-1' })
  })

  it('NO persiste PII (legalName) en el trail', async () => {
    await screenSubject(makeAdmin(), { subjectType: 'creator', subjectId: 'creator-1', legalName: 'Ada Lovelace' })
    const row = JSON.stringify(inserts[0].row)
    expect(row).not.toContain('Ada Lovelace')
  })

  it('un throw del provider se PROPAGA y NO toca la DB', async () => {
    screenThrows = true
    await expect(
      screenSubject(makeAdmin(), { subjectType: 'creator', subjectId: 'creator-1' }),
    ).rejects.toThrow(/provider boom/)
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('resiliente: un fallo del INSERT del trail NO pierde el update del status', async () => {
    insertError = { message: 'trail insert boom' }
    const r = await screenSubject(makeAdmin(), { subjectType: 'creator', subjectId: 'creator-1' })
    // El status igual se estampó y el resultado se devuelve.
    expect(updates).toHaveLength(1)
    expect(updates[0].patch).toMatchObject({ sanctions_status: 'clear' })
    expect(r.status).toBe('clear')
  })

  it('un fallo del update del status SÍ tira (load-bearing)', async () => {
    configured = true // sin lectura de anti-downgrade — va directo al update
    updateError = { message: 'status update boom' }
    await expect(
      screenSubject(makeAdmin(), { subjectType: 'consumer', subjectId: 'fan-1' }),
    ).rejects.toThrow(/status update failed/)
  })

  it('anti-downgrade: con stub, un review NO baja un hit persistido (consumer)', async () => {
    configured = false
    currentStatusRow = { consumer_sanctions_status: 'hit' }
    screenResult = { status: 'review', ref: 'R' }
    const r = await screenSubject(makeAdmin(), { subjectType: 'consumer', subjectId: 'fan-1' })
    // El trail registra el veredicto CRUDO del provider ('review')…
    expect(inserts[0].row).toMatchObject({ status: 'review' })
    // …pero el fast-path PRESERVA 'hit' (sólo un vendor real puede sacar de hit).
    expect(updates[0].patch).toMatchObject({ consumer_sanctions_status: 'hit' })
    expect(r.status).toBe('hit')
  })

  it('anti-downgrade: con stub, un review SÍ aplica si el sujeto NO era hit (creator)', async () => {
    configured = false
    currentStatusRow = { sanctions_status: 'clear' }
    screenResult = { status: 'review', ref: 'R' }
    const r = await screenSubject(makeAdmin(), { subjectType: 'creator', subjectId: 'creator-1' })
    expect(updates[0].patch).toMatchObject({ sanctions_status: 'review' })
    expect(r.status).toBe('review')
  })

  it('vendor real: un clear SÍ puede sacar de hit (no hay anti-downgrade con vendor)', async () => {
    configured = true
    currentStatusRow = { consumer_sanctions_status: 'hit' }
    screenResult = { status: 'clear', ref: 'R' }
    const r = await screenSubject(makeAdmin(), { subjectType: 'consumer', subjectId: 'fan-1' })
    expect(updates[0].patch).toMatchObject({ consumer_sanctions_status: 'clear' })
    expect(r.status).toBe('clear')
  })
})
