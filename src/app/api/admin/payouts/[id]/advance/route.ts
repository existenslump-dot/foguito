import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { advancePayout, type AdvancePayoutStatus, type PayoutTargetStatus } from '@/lib/payouts'
import { getPayoutProvider } from '@/lib/payouts/provider'
import { screenSubject } from '@/lib/aml'
import { assembleTravelRuleInfo, submitTravelRule } from '@/lib/payouts/provider/travel-rule'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Acción del admin → estado destino de la RPC. */
const ACTION_TO_STATUS: Record<string, PayoutTargetStatus> = {
  approve: 'approved',
  send: 'sent',
  fail: 'failed',
  hold: 'held',
}

type PayoutRow = {
  id: string
  creator_id: string
  amount_usdt: number | string
  amount_foguitos: number | string | null
  status: string
  tax_withholding: number | string | null
} | null

type CreatorRow = {
  user_id: string
  pseudonym: string | null
  country: string | null
} | null

/**
 * POST /api/admin/payouts/[id]/advance — la transición REGULADA de money-out (PR-8).
 *
 * Admin-only con TOTP FRESCA (`requireFreshTotp: true`) — money-out es la operación
 * de mayor privilegio de la plataforma. Body: { action } ∈ approve|send|fail|hold.
 *
 * ┌── `send` (fail-closed, ORDEN ESTRICTO) ──────────────────────────────────────┐
 * │ Sólo desde 'approved' (si no, NO se toca al VASP → evita doble-transferencia).│
 * │ (a) re-screenea sanciones → si ≠ 'clear' ⇒ held + audit, NO envía            │
 * │ (b) arma + submite Travel Rule → ref                                          │
 * │ (c) getPayoutProvider().sendPayout(...) → si TIRA ⇒ failed + 502 (nunca sent) │
 * │ (d) advance_payout('sent', travelRuleRef, sanctionsRef, vaspTxId, tax)         │
 * │ CUALQUIER throw de provider (sanciones/Travel Rule/VASP) ⇒ NO se marca 'sent'.│
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * approve/fail/hold: sólo `advance_payout` con el estado destino. Toda transición
 * se audita (`payout_advanced`). La RPC + `payouts_guard` son la autoridad final
 * (re-chequean payout-KYC/sanciones/Travel Rule al marcar 'sent').
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Money-out = máximo privilegio: 2FA ENROLADA (fail-closed) + verificación FRESCA.
  // El gate de página del middleware no cubre /api/*, así que se enforcea acá.
  const gate = await requireAdmin(req, { requireFreshTotp: true, requireTotpEnrolled: true })
  if (!gate.ok) return gate.response

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id inválido (UUID esperado)' }, { status: 400 })
  }

  const body = (await req.json().catch(() => null)) as { action?: unknown } | null
  const action = typeof body?.action === 'string' ? body.action.trim() : ''
  const targetStatus = ACTION_TO_STATUS[action]
  if (!targetStatus) {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  try {
    if (action === 'send') {
      return await handleSend(req, admin, id, gate.userId)
    }

    // approve / fail / hold — sólo mueve la máquina de estados.
    const { data: status, error } = await advancePayout(admin, id, targetStatus)
    if (error) {
      console.error('[api/admin/payouts/advance] rpc error', error)
      return NextResponse.json({ error: 'error' }, { status: 500 })
    }
    void recordAudit({
      eventType: 'payout_advanced',
      actorRole: 'admin',
      actorUserId: gate.userId,
      subjectType: 'payout',
      subjectId: id,
      req,
      metadata: { action, target_status: targetStatus, rpc_status: status },
    })
    return mapAdvance(status)
  } catch (e) {
    console.error('[api/admin/payouts/advance] unexpected error', e)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
}

/**
 * El path `send` — regulado y fail-closed. Cualquier throw de un provider deja el
 * payout en 'held'/'failed', NUNCA en 'sent'.
 */
async function handleSend(
  req: NextRequest,
  admin: ReturnType<typeof getSupabaseAdmin>,
  id: string,
  adminUserId: string,
): Promise<NextResponse> {
  // Cargar el payout — necesito estado + monto + creator para screening/Travel Rule.
  const { data: payout, error: pErr } = (await admin
    .from('payouts')
    .select('id, creator_id, amount_usdt, amount_foguitos, status, tax_withholding')
    .eq('id', id)
    .maybeSingle()) as { data: PayoutRow; error: unknown }
  if (pErr) {
    console.error('[api/admin/payouts/advance] payout lookup error', pErr)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
  if (!payout) {
    return NextResponse.json({ error: 'no_payout' }, { status: 404 })
  }

  // GUARD ANTI DOBLE-TRANSFERENCIA: sólo se toca al VASP desde 'approved'. Para
  // cualquier otro estado se REPORTA sin avanzar ni tocar el provider — clave: NO
  // se llama advance('sent') sobre un payout en 'sending' (claim en curso de OTRO
  // request), porque los refs ya estampados lo marcarían 'sent' sin transferir acá.
  if (payout.status !== 'approved') {
    const map: Record<string, { code: string; http: number }> = {
      pending:  { code: 'not_approved', http: 409 },
      sending:  { code: 'in_progress',  http: 409 },
      sent:     { code: 'already',      http: 200 },
      failed:   { code: 'failed',       http: 409 },
      held:     { code: 'held',         http: 409 },
    }
    const m = map[payout.status] ?? { code: 'bad_transition', http: 409 }
    return NextResponse.json(
      m.http === 200 ? { status: 'already' } : { error: m.code },
      { status: m.http },
    )
  }

  const { data: creator } = (await admin
    .from('creators')
    .select('user_id, pseudonym, country')
    .eq('user_id', payout.creator_id)
    .maybeSingle()) as { data: CreatorRow }

  // (a) Re-screening de sanciones (defensa en profundidad; la RPC + guard son la
  //     autoridad final). Vía el motor AML → deja el trail append-only
  //     (subject_type='payout') + refresca `creators.sanctions_status`. Un throw del
  //     vendor (o del write) ⇒ held (no se pudo screenear → no envía).
  let sanctionsRef: string
  try {
    const screen = await screenSubject(admin, {
      subjectType: 'payout',
      subjectId: payout.creator_id,
      legalName: creator?.pseudonym ?? null,
      country: creator?.country ?? null,
    })
    sanctionsRef = screen.ref
    if (screen.status !== 'clear') {
      // No clear → held, NO se envía. La reserva queda retenida (no se revierte).
      await advancePayout(admin, id, 'held', { sanctionsRef: screen.ref })
      void recordAudit({
        eventType: 'payout_advanced',
        actorRole: 'admin',
        actorUserId: adminUserId,
        subjectType: 'payout',
        subjectId: id,
        req,
        metadata: { action: 'send', outcome: 'held', reason: 'sanctions_not_clear', sanctions_status: screen.status },
      })
      return NextResponse.json({ status: 'held', reason: 'sanctions_not_clear' }, { status: 200 })
    }
  } catch (e) {
    console.error('[api/admin/payouts/advance] sanctions screen threw', e)
    await advancePayout(admin, id, 'held')
    void recordAudit({
      eventType: 'payout_advanced',
      actorRole: 'admin',
      actorUserId: adminUserId,
      subjectType: 'payout',
      subjectId: id,
      req,
      metadata: { action: 'send', outcome: 'held', reason: 'sanctions_provider_error' },
    })
    return NextResponse.json({ error: 'sanctions_unavailable' }, { status: 502 })
  }

  // (b) Armar + submitir el Travel Rule. Un throw ⇒ held (no se pudo cumplir el
  //     Travel Rule → no envía; la reserva queda retenida).
  let travelRuleRef: string
  try {
    const info = assembleTravelRuleInfo(
      { id: payout.id, creatorId: payout.creator_id, amountUsdt: Number(payout.amount_usdt) },
      { userId: payout.creator_id, legalName: creator?.pseudonym ?? null, country: creator?.country ?? null },
    )
    const tr = await submitTravelRule(info)
    travelRuleRef = tr.ref
  } catch (e) {
    console.error('[api/admin/payouts/advance] travel-rule submit threw', e)
    await advancePayout(admin, id, 'held', { sanctionsRef })
    void recordAudit({
      eventType: 'payout_advanced',
      actorRole: 'admin',
      actorUserId: adminUserId,
      subjectType: 'payout',
      subjectId: id,
      req,
      metadata: { action: 'send', outcome: 'held', reason: 'travel_rule_error' },
    })
    return NextResponse.json({ error: 'travel_rule_unavailable' }, { status: 502 })
  }

  // (c) CLAIM ATÓMICO: approved→'sending' estampando los refs ANTES de tocar el
  //     VASP. El advisory lock de la RPC serializa: si dos 'send' concurren, sólo
  //     UNO gana (approved→sending); el resto ve 'sending' → bad_transition y NO
  //     llama al VASP (cierra la doble-transferencia). Además, al persistir el
  //     travel_rule_ref acá, el webhook puede completar 'sent' si el paso (e) falla.
  {
    const { data: claim, error: claimErr } = await advancePayout(admin, id, 'sending', {
      travelRuleRef,
      sanctionsRef,
    })
    if (claimErr) {
      console.error('[api/admin/payouts/advance] claim (sending) rpc error', claimErr)
      return NextResponse.json({ error: 'error' }, { status: 500 })
    }
    if (claim !== 'ok') {
      // Perdió el race o cambió el estado → NO se llama al VASP.
      void recordAudit({
        eventType: 'payout_advanced',
        actorRole: 'admin',
        actorUserId: adminUserId,
        subjectType: 'payout',
        subjectId: id,
        req,
        metadata: { action: 'send', outcome: 'claim_lost', rpc_status: claim },
      })
      return mapAdvance(claim)
    }
  }

  // (d) Ordenar la transferencia al VASP. Un throw (stub/no cableado) ⇒ failed (la
  //     transferencia no ocurrió → se revierte la reserva a earnings). NUNCA 'sent'.
  let vaspTxId: string
  try {
    const result = await getPayoutProvider().sendPayout(payout.id, {
      creatorId: payout.creator_id,
      amountUsdt: Number(payout.amount_usdt),
      beneficiary: {
        creatorId: payout.creator_id,
        legalName: creator?.pseudonym ?? null,
        country: creator?.country ?? null,
      },
    })
    vaspTxId = result.vaspTxId
  } catch (e) {
    console.error('[api/admin/payouts/advance] VASP sendPayout threw', e)
    await advancePayout(admin, id, 'failed', { travelRuleRef, sanctionsRef })
    void recordAudit({
      eventType: 'payout_advanced',
      actorRole: 'admin',
      actorUserId: adminUserId,
      subjectType: 'payout',
      subjectId: id,
      req,
      metadata: { action: 'send', outcome: 'failed', reason: 'vasp_error' },
    })
    return NextResponse.json({ error: 'vasp_unavailable' }, { status: 502 })
  }

  // (e) Recién ahora se marca 'sent' (la RPC + payouts_guard vuelven a exigir
  //     Travel Rule + payout-KYC + sanciones 'clear' en la DB — back-stop). Los
  //     refs ya se estamparon en el claim (c) → el webhook podría completar esto.
  const taxWithholding =
    payout.tax_withholding == null ? null : Number(payout.tax_withholding)
  const { data: status, error } = await advancePayout(admin, id, 'sent', {
    travelRuleRef,
    sanctionsRef,
    vaspTxId,
    taxWithholding: Number.isFinite(taxWithholding as number) ? taxWithholding : null,
  })
  if (error) {
    console.error('[api/admin/payouts/advance] advance_payout(sent) error', error)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
  void recordAudit({
    eventType: 'payout_advanced',
    actorRole: 'admin',
    actorUserId: adminUserId,
    subjectType: 'payout',
    subjectId: id,
    req,
    metadata: {
      action: 'send',
      target_status: 'sent',
      rpc_status: status,
      vasp_tx_id: vaspTxId,
      travel_rule_ref: travelRuleRef,
      sanctions_ref: sanctionsRef,
    },
  })
  return mapAdvance(status)
}

/** Mapea el estado de `advance_payout` → HTTP. */
function mapAdvance(status: AdvancePayoutStatus | null): NextResponse {
  switch (status) {
    case 'ok':
    case 'already':
      return NextResponse.json({ status: status === 'already' ? 'already' : 'ok' }, { status: 200 })
    case 'no_payout':
      return NextResponse.json({ error: 'no_payout' }, { status: 404 })
    case 'terminal':
    case 'bad_transition':
    case 'missing_travel_rule':
      return NextResponse.json({ error: status }, { status: 409 })
    case 'not_eligible':
      return NextResponse.json({ error: 'not_eligible' }, { status: 403 })
    case 'invalid':
    case 'invalid_status':
      return NextResponse.json({ error: status }, { status: 400 })
    default:
      console.error('[api/admin/payouts/advance] unexpected rpc status', status)
      return NextResponse.json({ error: 'error' }, { status: 500 })
  }
}
