import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { getOptionalUser } from '@/lib/clients/require-user'
import { getPaymentsKit } from '@/lib/payments/kit'
import { PAYMENTS_DISABLED, maintenanceJson } from '@/lib/maintenance'
import { MARKETPLACE, PAYMENTS_ENABLED } from '@/config/marketplace.config'

export const runtime = 'nodejs'

/**
 * Charge a Bricks-tokenized card — thin adapter over the payments kit.
 *
 * The charged amount is the PENDING ROW's amount (recorded from the server
 * catalogue at preference time), never the client body's transaction_amount.
 * Previously the body amount was charged verbatim — the webhook's mismatch
 * check contained the fraud (no activation), but the charge itself could be
 * made for an arbitrary amount. Now the body amount is ignored entirely.
 */
export async function POST(req: NextRequest) {
  // Payments is a paid add-on, off by default. When off the route is inert.
  if (!PAYMENTS_ENABLED) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (PAYMENTS_DISABLED) {
    return NextResponse.json(maintenanceJson(), { status: 503 })
  }
  try {
    const admin = getSupabaseAdmin()
    const userId = await getOptionalUser(req)

    const body = await req.json()
    const { internal_id, token, issuer_id, payment_method_id, installments, payer } = body

    if (!internal_id) {
      return NextResponse.json({ error: 'Missing internal_id' }, { status: 400 })
    }
    // MP rejects a payment when any required brick field is missing — surface
    // that up-front with a clearer message.
    if (!token) {
      return NextResponse.json({
        error: 'Faltan datos de la tarjeta (token). Recargá el formulario e ingresá los datos de nuevo.',
      }, { status: 400 })
    }
    if (!payment_method_id) {
      return NextResponse.json({
        error: 'Faltan datos del método de pago. Recargá el formulario.',
      }, { status: 400 })
    }

    // Look up the pending payment row by internal id. If the user is
    // authenticated we enforce ownership; anonymous callers (when the
    // deployment opts in) match on the opaque uuid alone.
    let lookup = admin.from('mp_payments').select('*').eq('id', internal_id)
    if (userId) lookup = lookup.eq('user_id', userId)
    const { data: record } = await lookup.single()

    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    try {
      const session = await getPaymentsKit().createCheckout({
        provider: 'mercadopago',
        method: 'card_token',
        orderRef: internal_id,
        // Server-authoritative: the row's amount, not the body's.
        amount: { currency: MARKETPLACE.market.currency, value: Number(record.amount_ars) },
        description: `Marketplace — ${record.package_id}`,
        payerEmail: payer?.email,
        card: {
          token,
          paymentMethodId: payment_method_id,
          installments: typeof installments === 'number' ? installments : 1,
          issuerId: issuer_id != null ? String(issuer_id) : undefined,
          payerIdentification: payer?.identification,
        },
      })

      // The gateway may return a 'rejected' verdict without throwing (card
      // declined, invalid CVV, …). Surface the actual reason to the UI.
      if (session.status === 'payment.failed') {
        return NextResponse.json({
          error: session.statusDetail || 'Payment rejected',
          mp_status: 'rejected',
          mp_status_detail: session.statusDetail,
        }, { status: 400 })
      }

      return NextResponse.json({
        payment_id: session.gatewayId,
        mp_status: session.status === 'payment.confirmed' ? 'approved' : 'pending',
      })
    } catch (mpErr: unknown) {
      // MP SDK throws an error shaped { message?, status?, cause?, error? }.
      const e = mpErr as {
        message?: string
        status?: number
        cause?: Array<{ description?: string }> | undefined
        error?: unknown
      }
      console.error('[MP] card charge failed', {
        message: e.message,
        status: e.status,
        cause: e.cause,
      })
      const detail = e.cause?.[0]?.description || e.message || 'Mercado Pago rejected the payment'
      return NextResponse.json({ error: detail, mp_raw: e.cause ?? null }, { status: 400 })
    }
  } catch (err) {
    console.error('[MP] procesar-pago unexpected error:', err)
    return NextResponse.json({ error: 'Payment failed' }, { status: 500 })
  }
}
