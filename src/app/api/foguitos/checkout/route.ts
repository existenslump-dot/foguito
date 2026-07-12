import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireUser } from '@/lib/clients/require-user'
import { rateLimit } from '@/lib/rateLimit'
import { recordAudit } from '@/lib/audit'
import { getPack } from '@/lib/foguitos/packs'
import { isFoguitoPaymentsEnabled } from '@/lib/foguitos/config'
import { getFoguitoPaymentProvider } from '@/lib/foguitos/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/foguitos/checkout — alta de una compra de foguitos (PR-7 money-in).
 *
 * ┌── ORDEN FAIL-CLOSED (cada paso deniega; nada de dinero se mueve sin todos) ──┐
 * │ 1. isFoguitoPaymentsEnabled() ⇒ 404 (inerte sin el flag; el riel no existe) │
 * │ 2. requireUser → sesión + same-origin (401/403). El userId sale de la SESIÓN│
 * │    y se congela en la orden — NUNCA de un user_id del body.                  │
 * │ 3. body { packId } válido contra el catálogo ⇒ 400 (fail-closed ante junk)  │
 * │ 4. rate-limit por fan ⇒ 429                                                  │
 * │ 5. INSERT de la orden 'pending' (service-role) con el monto/precio DEL       │
 * │    CATÁLOGO, ANTES de llamar al provider (fail-closed: jamás se entrega un   │
 * │    target de pago que no se registró — el webhook resuelve el fulfilment de  │
 * │    esta fila).                                                               │
 * │ 6. provider.createCheckout(orderRef, pack). Si tira ⇒ marca la orden 'failed'│
 * │    y responde 502 (no se cobra por algo que no se pudo dar de alta).         │
 * │ 7. UPDATE de la orden con el gateway_tx_id.                                  │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * PAN CERO: ningún dato de tarjeta toca la app — el provider hostea el pago y
 * sólo devolvemos su dirección/URL. El monto de foguitos acreditado sale SIEMPRE
 * de la orden (fijada acá desde el catálogo), jamás del cliente ni del provider.
 */

// Tope conservador: pocas altas de compra por minuto por fan. Corta retry-storms
// / abuso sin molestar el uso legítimo.
const RL_LIMIT = 10
const RL_WINDOW_MS = 60_000

const PROVIDER_NAME = 'nowpayments'

export async function POST(req: NextRequest) {
  try {
    // 1. Feature flag: sin el money-in habilitado el riel es inerte (404).
    if (!isFoguitoPaymentsEnabled()) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    // 2. Sesión — el userId se liga a la sesión, NUNCA a un user_id del body.
    const gate = await requireUser(req)
    if (!gate.ok) return gate.response
    const userId = gate.userId

    // 3. Body + validación del pack contra el catálogo server-authoritative.
    const body = (await req.json().catch(() => null)) as { packId?: unknown } | null
    const packId = typeof body?.packId === 'string' ? body.packId : ''
    const pack = getPack(packId)
    if (!pack) {
      return NextResponse.json({ error: 'invalid_pack' }, { status: 400 })
    }

    // 4. Rate-limit por fan.
    const rl = await rateLimit(`foguitos-checkout:${userId}`, RL_LIMIT, RL_WINDOW_MS)
    if (!rl.success) {
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }

    const orderRef = `ord_${randomUUID()}`
    const admin = getSupabaseAdmin()

    // 5. Orden 'pending' ANTES del provider (fail-closed). El monto de foguitos y
    //    el precio salen del CATÁLOGO — el webhook los lee de acá, jamás del IPN.
    const { error: insertErr } = await admin.from('foguito_orders').insert({
      order_ref: orderRef,
      provider: PROVIDER_NAME,
      user_id: userId,
      pack_id: pack.id,
      amount_foguitos: pack.foguitos,
      price_amount: pack.priceAmount,
      price_currency: pack.priceCurrency,
      status: 'pending',
    })
    if (insertErr) {
      console.error('[api/foguitos/checkout] order insert failed', insertErr)
      return NextResponse.json({ error: 'error' }, { status: 500 })
    }

    // 6. Alta del cobro en el provider. Si tira, marca la orden 'failed' (sólo
    //    mientras siga 'pending') y responde 502 — nunca se entrega un target de
    //    pago que no se pudo crear.
    let checkout
    try {
      checkout = await getFoguitoPaymentProvider().createCheckout(orderRef, pack)
    } catch (providerErr) {
      console.error(
        '[api/foguitos/checkout] provider error:',
        providerErr instanceof Error ? providerErr.message : providerErr,
      )
      await admin
        .from('foguito_orders')
        .update({ status: 'failed' })
        .eq('order_ref', orderRef)
        .eq('status', 'pending')
      return NextResponse.json({ error: 'payment_creation_failed' }, { status: 502 })
    }

    // 7. Persistir el id del pago del gateway para correlacionar el IPN.
    const { error: updateErr } = await admin
      .from('foguito_orders')
      .update({ gateway_tx_id: checkout.gatewayTxId })
      .eq('order_ref', orderRef)
    if (updateErr) {
      // No es fatal para el fan (la orden ya existe y el IPN correlaciona por
      // order_ref), pero se loguea — el gateway_tx_id es la clave secundaria.
      console.error('[api/foguitos/checkout] gateway_tx_id update failed', updateErr)
    }

    void recordAudit({
      eventType: 'foguitos_checkout_created',
      actorRole: 'user',
      actorUserId: userId,
      subjectType: 'foguito_order',
      subjectId: orderRef,
      req,
      metadata: {
        provider: PROVIDER_NAME,
        pack_id: pack.id,
        amount_foguitos: pack.foguitos,
        price_amount: pack.priceAmount,
        price_currency: pack.priceCurrency,
      },
    })

    return NextResponse.json({
      orderRef,
      payAddress: checkout.payAddress,
      payUrl: checkout.payUrl,
    })
  } catch (e) {
    console.error('[api/foguitos/checkout] unexpected error', e)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
}
