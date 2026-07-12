import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * `credit_ledger` helpers — el lado de LECTURA del saldo del fan + wrappers
 * tipados sobre las RPCs de gasto/otorgamiento (PR-6).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ INVARIANTE: el saldo de foguitos es SIEMPRE la suma del `credit_ledger`,    │
 * │ NUNCA `profiles.credits`. Una pata del fan lleva `user_id = <él>` y la RLS  │
 * │ `ledger_select` le deja leer SOLO sus filas. Balance = SUM(credit) −        │
 * │ SUM(debit) sobre esas filas.                                                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Las RPCs (`unlock_ppv_content` / `subscribe_creator` / `credit_foguitos`) son
 * SECURITY DEFINER y SÓLO ejecutables por el service-role (getSupabaseAdmin()):
 * el precio/monto sale SIEMPRE de la DB, jamás del cliente. Estos wrappers son
 * finos a propósito — no re-implementan reglas, sólo tipan el `.rpc(...)`.
 */

/** Una pata del ledger, tal como la ve el fan (RLS acota a `user_id = él`). */
type LedgerLeg = {
  direction: 'credit' | 'debit'
  amount: number | null
}

/** Estado textual que devuelven las RPCs de PR-6 (fuente: la DB). */
export type UnlockStatus =
  | 'ok'
  | 'already_unlocked'
  | 'insufficient_funds'
  | 'not_purchasable'
  | 'no_price'
  | 'not_found'
  | 'invalid'

export type SubscribeStatus =
  | 'ok'
  | 'already_active'
  | 'insufficient_funds'
  | 'subs_not_offered'
  | 'invalid'

export type CreditStatus = 'ok' | 'already_applied' | 'invalid'

/**
 * Saldo de foguitos del fan = SUM(credit) − SUM(debit) sobre SUS propias filas
 * del ledger. Se pasa el cliente cookie-scoped del fan (la RLS `ledger_select`
 * lo acota a `user_id = auth.uid()`), NO el service-role.
 *
 * FAIL-SAFE A CERO: ante error/consulta vacía devuelve 0, y nunca un negativo
 * "por error" ni NaN — el saldo mostrado jamás miente hacia arriba y jamás
 * rompe el render. (Un negativo real es imposible: las RPCs chequean saldo con
 * lock por-fan antes de debitar.)
 */
export async function getFoguitoBalance(
  client: SupabaseClient,
  userId: string,
): Promise<number> {
  try {
    const { data, error } = await client
      .from('credit_ledger')
      .select('direction, amount')
      .eq('user_id', userId)
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
 * Desbloquear una pieza PPV. SÓLO con el `admin` service-role (único rol con
 * EXECUTE sobre la RPC). El fanId sale de la sesión en el endpoint, nunca del
 * body; el precio lo pone la DB dentro de la RPC.
 */
export async function unlockPpv(
  admin: SupabaseClient,
  fanId: string,
  contentId: string,
): Promise<{ data: UnlockStatus | null; error: unknown }> {
  const { data, error } = await admin.rpc('unlock_ppv_content', {
    p_fan: fanId,
    p_content: contentId,
  })
  return { data: (data as UnlockStatus | null) ?? null, error }
}

/**
 * Suscribir un fan a una creadora (precio único MVP). SÓLO con el `admin`
 * service-role. fanId de la sesión; precio/period de la DB.
 */
export async function subscribeCreator(
  admin: SupabaseClient,
  fanId: string,
  creatorId: string,
): Promise<{ data: SubscribeStatus | null; error: unknown }> {
  const { data, error } = await admin.rpc('subscribe_creator', {
    p_fan: fanId,
    p_creator: creatorId,
  })
  return { data: (data as SubscribeStatus | null) ?? null, error }
}

/**
 * Acreditar foguitos (top-up admin/stub; el money-in real es PR-7). SÓLO con el
 * `admin` service-role. Idempotente por `p_idempotency_key`.
 */
export async function creditFoguitos(
  admin: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  idemKey: string | null,
): Promise<{ data: CreditStatus | null; error: unknown }> {
  const { data, error } = await admin.rpc('credit_foguitos', {
    p_user: userId,
    p_amount: amount,
    p_reason: reason,
    p_idempotency_key: idemKey,
  })
  return { data: (data as CreditStatus | null) ?? null, error }
}
