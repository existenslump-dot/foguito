import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { recordAudit } from '@/lib/audit'
import { verifyNowpaymentsSignature } from '@/lib/foguitos/provider/signature'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/foguitos/nowpayments — IPN de money-in (PR-7).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ El ÚNICO factor de confianza es la firma HMAC del IPN. NO hay sesión, NO    │
 * │ hay same-origin (un webhook no manda cookies ni Origin). Un evento sin firma│
 * │ válida NO acredita NADA (401). El monto acreditado sale de la ORDEN (fijado │
 * │ server-side en el checkout desde el catálogo), NUNCA del body del IPN.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Orden:
 *   1. Leer el body CRUDO (bytes exactos para el HMAC). Parsear SÓLO tras verificar.
 *   2. Verificar la firma sobre los bytes crudos (constant-time) ⇒ false → 401.
 *   3. Parsear JSON.
 *   4. Buscar la orden por order_ref. Desconocida → 200 + alerta (nunca 500-loop).
 *   5. Chequeo gateway-truth: el monto/moneda del IPN deben matchear la ORDEN.
 *      Mismatch → NO se acredita (log + audit + 200).
 *   6. Mapear payment_status → acción. SÓLO 'finished' acredita (purchase_foguitos).
 *   7. Idempotente vía la RPC (un 'finished' re-entregado → 'already_applied').
 *   8. Ack 200 para todo evento verificado ya manejado (el provider deja de
 *      reintentar); 401 sólo firma inválida; 500 sólo error inesperado del server.
 */

// Estados NO finales de NOWPayments: progreso, todavía sin settlement. Se ackean
// sin acreditar (nunca se credita en un estado != 'finished') y NO se terminaliza
// la orden. `partially_paid` va acá A PROPÓSITO: NO es terminal en NOWPayments —
// el fan puede mandar el resto y la invoice pasa a 'finished'; si la estampáramos
// 'failed', ese 'finished' posterior caería en 'not_pending' (cobrado sin crédito).
const NON_FINAL_STATUSES = new Set([
  'waiting', 'confirming', 'confirmed', 'sending', 'partially_paid',
])
// Estados terminales de falla: se estampa la orden 'failed'/'expired' SÓLO
// mientras siga 'pending' (terminal-freeze: nunca se demota una orden ya 'paid').
// `refunded` es terminal (la plata volvió); el clawback de una orden ya 'paid'
// (refund tras 'finished') es materia de PR-8 (reversa de ledger) — acá el
// `.eq('status','pending')` no demota una orden pagada.
const FAILURE_STATUSES = new Set(['failed', 'refunded'])
const EXPIRY_STATUSES = new Set(['expired'])

type OrderRow = {
  order_ref: string
  status: string
  provider: string
  price_amount: number | string
  price_currency: string
} | null

export async function POST(req: Request) {
  try {
    // 1. Body CRUDO — los bytes exactos que cubre la firma. Parsear DESPUÉS.
    const rawBody = await req.text()

    // 2. Firma: el único factor de confianza. Fail-closed → 401, no se credita nada.
    if (!verifyNowpaymentsSignature(rawBody, req.headers.get('x-nowpayments-sig'))) {
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
    }

    // 3. Recién ahora (firma OK) parseamos.
    let event: Record<string, unknown>
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      // Firma válida pero body no-JSON: no hay nada que hacer, ackear.
      return NextResponse.json({ ok: true, warn: 'unparseable body' })
    }

    const orderRef = typeof event.order_id === 'string' ? event.order_id : ''
    const paymentStatus = typeof event.payment_status === 'string' ? event.payment_status : ''
    if (!orderRef) {
      // Un IPN firmado sin order_id no correlaciona con ninguna orden → ackear.
      return NextResponse.json({ ok: true, warn: 'missing order_id' })
    }

    const admin = getSupabaseAdmin()

    // 4. Buscar la orden. Desconocida → ack 200 + alerta (mirror del fail-safe de
    //    unknown-id del engine): puede ser un retry de otro entorno o tampering.
    const { data: order } = (await admin
      .from('foguito_orders')
      .select('order_ref, status, provider, price_amount, price_currency')
      .eq('order_ref', orderRef)
      .maybeSingle()) as { data: OrderRow }

    if (!order) {
      console.error('[foguitos/ipn] unknown order_ref:', orderRef)
      void recordAudit({
        eventType: 'foguitos_ipn_unknown_order',
        actorRole: 'system',
        subjectType: 'foguito_order',
        subjectId: orderRef,
        req,
        metadata: { payment_status: paymentStatus },
      })
      return NextResponse.json({ ok: true, warn: 'unknown order' })
    }

    // 5. Chequeo gateway-truth: el precio/moneda del IPN deben coincidir con los
    //    de la ORDEN (fijados en el checkout). NO se deriva el crédito del IPN —
    //    esto sólo autoriza a cumplir la orden. Un mismatch → NO se acredita.
    if (!amountMatches(event, order)) {
      console.error('[foguitos/ipn] amount/currency mismatch for order', orderRef, {
        event: { price_amount: event.price_amount, price_currency: event.price_currency },
        order: { price_amount: order.price_amount, price_currency: order.price_currency },
      })
      void recordAudit({
        eventType: 'foguitos_ipn_amount_mismatch',
        actorRole: 'system',
        subjectType: 'foguito_order',
        subjectId: orderRef,
        req,
        metadata: {
          payment_status: paymentStatus,
          event_price_amount: event.price_amount ?? null,
          event_price_currency: event.price_currency ?? null,
          order_price_amount: order.price_amount,
          order_price_currency: order.price_currency,
        },
      })
      return NextResponse.json({ ok: true, warn: 'amount mismatch' })
    }

    // 6. Mapeo estado → acción.
    if (paymentStatus === 'finished') {
      // Único estado que acredita. El monto sale de la ORDEN dentro de la RPC
      // (atómica + idempotente); un 'finished' re-entregado → 'already_applied'.
      const { data: status, error } = await admin.rpc('purchase_foguitos', {
        p_order_ref: orderRef,
      })
      if (error) {
        // El crédito NO ocurrió: 500 para que NOWPayments REINTENTE.
        console.error('[foguitos/ipn] purchase_foguitos rpc error', error)
        return NextResponse.json({ error: 'fulfilment_failed' }, { status: 500 })
      }
      if (status === 'ok') {
        void recordAudit({
          eventType: 'foguitos_purchased',
          actorRole: 'system',
          subjectType: 'foguito_order',
          subjectId: orderRef,
          req,
          metadata: { provider: order.provider, payment_status: paymentStatus },
        })
      }
      // 'ok' | 'already_applied' | 'not_pending' | 'no_order' | 'invalid' → todos
      // se ackean (idempotencia / terminal-freeze los resuelve la RPC).
      return NextResponse.json({ ok: true, status })
    }

    if (FAILURE_STATUSES.has(paymentStatus) || EXPIRY_STATUSES.has(paymentStatus)) {
      // Estampar la falla SÓLO mientras siga 'pending' (nunca demotar 'paid').
      const newStatus = EXPIRY_STATUSES.has(paymentStatus) ? 'expired' : 'failed'
      await admin
        .from('foguito_orders')
        .update({ status: newStatus })
        .eq('order_ref', orderRef)
        .eq('status', 'pending')
      return NextResponse.json({ ok: true, status: paymentStatus })
    }

    // Estados no finales ('waiting'/'confirming'/'confirmed'/'sending') y
    // cualquier estado desconocido: ack sin acreditar (NUNCA se credita fuera de
    // 'finished').
    if (!NON_FINAL_STATUSES.has(paymentStatus)) {
      console.warn('[foguitos/ipn] unhandled payment_status (no credit):', paymentStatus)
    }
    return NextResponse.json({ ok: true, status: paymentStatus || 'unknown' })
  } catch (e) {
    console.error('[foguitos/ipn] unexpected error', e)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
}

/**
 * ¿El precio/moneda del IPN coinciden con los de la orden? Comparación tolerante
 * a floats (epsilon) para el monto y case-insensitive para la moneda. Si el IPN
 * no trae price_amount, es un mismatch (fail-closed: nunca se asume el monto).
 */
function amountMatches(event: Record<string, unknown>, order: NonNullable<OrderRow>): boolean {
  const eventAmount = Number(event.price_amount)
  const orderAmount = Number(order.price_amount)
  if (!Number.isFinite(eventAmount) || !Number.isFinite(orderAmount)) return false
  if (Math.abs(eventAmount - orderAmount) > 0.01) return false

  const eventCurrency = String(event.price_currency ?? '').trim().toUpperCase()
  const orderCurrency = String(order.price_currency ?? '').trim().toUpperCase()
  if (!eventCurrency || eventCurrency !== orderCurrency) return false

  return true
}
