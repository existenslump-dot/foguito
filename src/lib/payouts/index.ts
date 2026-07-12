import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Lado de LECTURA del balance de earnings de la creadora + wrappers tipados sobre
 * las RPCs de payout (PR-8 money-out).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️ RLS: las patas de `creator:<uuid>:earnings` llevan `user_id = NULL`, así │
 * │ que la RLS `ledger_select` (user_id = auth.uid() OR is_admin()) NO deja a   │
 * │ la creadora leer sus PROPIOS earnings. Por eso `getCreatorEarningsBalance`  │
 * │ EXIGE el cliente service-role (getSupabaseAdmin()) y se llama SÓLO           │
 * │ server-side, SIEMPRE acotado al id de la creadora de la SESIÓN. NUNCA se     │
 * │ expone una forma de que una creadora consulte earnings arbitrarios.         │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Las RPCs (`request_payout` / `advance_payout`) son SECURITY DEFINER y SÓLO
 * ejecutables por el service-role: el monto/reserva sale SIEMPRE de la DB, jamás
 * del cliente. Estos wrappers son finos — no re-implementan reglas, sólo tipan el
 * `.rpc(...)` con los nombres EXACTOS de parámetros.
 */

/** Una pata del ledger. */
type LedgerLeg = {
  direction: 'credit' | 'debit'
  amount: number | null
}

/** Estados de `request_payout` (fuente: la DB). */
export type RequestPayoutStatus =
  | 'ok'
  | 'not_eligible'
  | 'insufficient_earnings'
  | 'already_pending'
  | 'amount_too_small'
  | 'invalid'

/** Estados de `advance_payout` (fuente: la DB). */
export type AdvancePayoutStatus =
  | 'ok'
  | 'no_payout'
  | 'terminal'
  | 'already'
  | 'bad_transition'
  | 'missing_travel_rule'
  | 'not_eligible'
  | 'invalid'
  | 'invalid_status'

/** Estado destino de la máquina (lo que pasa por `p_new_status`). `sending` es el
 *  claim atómico (approved→sending) que reserva el envío antes de tocar el VASP. */
export type PayoutTargetStatus = 'approved' | 'sending' | 'sent' | 'failed' | 'held'

/** Referencias regulatorias que acompañan un `advance_payout`. */
export type AdvancePayoutRefs = {
  travelRuleRef?: string | null
  sanctionsRef?: string | null
  vaspTxId?: string | null
  taxWithholding?: number | null
}

/**
 * Balance de earnings pagables de la creadora = SUM(credit) − SUM(debit) sobre la
 * cuenta `creator:<uuid>:earnings`. Las reservas de payouts en vuelo ya están
 * debitadas de esta cuenta (van a `platform:payable`), así que el balance ya
 * descuenta lo reservado — no hay doble-gasto.
 *
 * ⚠️ Requiere el cliente service-role (ver el bloque de arriba). El `creatorId` DEBE
 * salir de la sesión server-side, nunca del cliente.
 *
 * FAIL-SAFE A CERO: ante error/consulta vacía devuelve 0, nunca un negativo "por
 * error" ni NaN — el saldo mostrado jamás miente hacia arriba ni rompe el render.
 */
export async function getCreatorEarningsBalance(
  client: SupabaseClient,
  creatorId: string,
): Promise<number> {
  try {
    const account = `creator:${creatorId}:earnings`
    const { data, error } = await client
      .from('credit_ledger')
      .select('direction, amount')
      .eq('account', account)
    if (error || !data) return 0

    let balance = 0
    for (const leg of data as LedgerLeg[]) {
      const amount = typeof leg.amount === 'number' ? leg.amount : Number(leg.amount)
      if (!Number.isFinite(amount)) continue
      if (leg.direction === 'credit') balance += amount
      else if (leg.direction === 'debit') balance -= amount
    }

    // Clamp: nunca negativo ni NaN hacia afuera (fail-safe).
    return Number.isFinite(balance) && balance > 0 ? balance : 0
  } catch {
    return 0
  }
}

/**
 * La creadora pide retirar N foguitos de sus earnings. SÓLO con el `admin`
 * service-role. El `creatorId` sale de la sesión en el endpoint, nunca del body;
 * la elegibilidad (payout-KYC + sanciones), el overdraft-guard y la reserva los
 * hace la RPC autoritativamente.
 */
export async function requestPayout(
  admin: SupabaseClient,
  creatorId: string,
  amountFoguitos: number,
): Promise<{ data: RequestPayoutStatus | null; error: unknown }> {
  const { data, error } = await admin.rpc('request_payout', {
    p_creator: creatorId,
    p_amount_foguitos: amountFoguitos,
  })
  return { data: (data as RequestPayoutStatus | null) ?? null, error }
}

/**
 * Avanza la máquina de estados de un payout (admin/compliance/VASP callback). SÓLO
 * con el `admin` service-role. En 'sent' la RPC exige travel_rule_ref + payout-KYC
 * verificado + sanciones 'clear' (y el `payouts_guard` es el back-stop de DB); en
 * 'failed' la RPC escribe la entrada compensatoria que devuelve la reserva.
 */
export async function advancePayout(
  admin: SupabaseClient,
  payoutId: string,
  newStatus: PayoutTargetStatus,
  refs?: AdvancePayoutRefs,
): Promise<{ data: AdvancePayoutStatus | null; error: unknown }> {
  const { data, error } = await admin.rpc('advance_payout', {
    p_payout: payoutId,
    p_new_status: newStatus,
    p_travel_rule_ref: refs?.travelRuleRef ?? null,
    p_sanctions_ref: refs?.sanctionsRef ?? null,
    p_vasp_tx_id: refs?.vaspTxId ?? null,
    p_tax_withholding: refs?.taxWithholding ?? null,
  })
  return { data: (data as AdvancePayoutStatus | null) ?? null, error }
}
