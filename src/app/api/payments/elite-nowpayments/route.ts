import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { getOptionalUser } from '@/lib/clients/require-user'
import { getPaymentsKit } from '@/lib/payments/kit'
import { sendEmail, ADMIN_EMAIL } from '@/lib/clients/resend'
import { ElitePaymentSchema, validationError } from '@/lib/validation/schemas'
import { PACKAGES } from '@/lib/packages'
import { renderEmail } from '@/lib/emails'
import { PAYMENTS_DISABLED, maintenanceJson } from '@/lib/maintenance'
import { PAYMENTS_ENABLED } from '@/config/marketplace.config'

export const runtime = 'nodejs'

/**
 * Create a NOWPayments *payment* (not invoice) for an Elite subscription.
 *
 * Flow:
 *   1. Validate email
 *   2. Insert pending row in elite_subscriptions (column names match the
 *      init migration: email / order_id / np_payment_id / pay_* — the
 *      previous version wrote columns that don't exist and every insert
 *      silently failed)
 *   3. Call NOWPayments /v1/payment → returns pay_address + pay_amount
 *   4. Store np_payment_id for webhook correlation
 *   5. Fire-and-forget pending emails to user + admin
 *
 * order_id is `elite_<uuid>` — the prefix routes the IPN to the Elite
 * handler, the uuid keeps it opaque (the old `elite-{email}-{ts}` leaked
 * the payer email and was enumerable).
 */
export async function POST(request: Request) {
  // Payments is a paid add-on, off by default. When off the route is inert.
  if (!PAYMENTS_ENABLED) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (PAYMENTS_DISABLED) {
    return NextResponse.json(maintenanceJson(), { status: 503 })
  }
  try {
    const parsed = ElitePaymentSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 })
    }
    const { email, package_id, renew_post_id } = parsed.data

    // Bind the subscription to the session user when present so the admin
    // panel can associate the Elite listing automatically. Elite checkout
    // stays email-addressable (high-touch tier), but fully anonymous
    // purchases follow the same deployment opt-in as the other flows.
    const userId = await getOptionalUser(request)
    if (!userId && process.env.PAYMENTS_ALLOW_ANONYMOUS !== 'true') {
      return NextResponse.json(
        { error: 'login_required', message: 'Iniciá sesión para completar el pago.' },
        { status: 401 },
      )
    }

    // Monthly by default; the 15-day Elite package rides the same flow with
    // its own price + duration (both server-authoritative from the catalogue).
    const elitePkg = PACKAGES[package_id ?? 'tier_elite']
    if (!process.env.NOWPAYMENTS_API_KEY) {
      console.error('[elite-nowpayments] NOWPAYMENTS_API_KEY missing')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const admin = getSupabaseAdmin()

    // Self-serve renewal: the target must exist and belong to the session
    // user BEFORE we take the money (mirrors the MP/crypto routes).
    if (renew_post_id) {
      if (!userId) {
        return NextResponse.json(
          { error: 'login_required', message: 'Iniciá sesión para renovar tu publicación.' },
          { status: 401 },
        )
      }
      const { data: renewPost } = await admin
        .from('posts').select('user_id').eq('id', renew_post_id).maybeSingle()
      if (!renewPost || renewPost.user_id !== userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // ── Insert pending subscription ──────────
    const orderId = `elite_${randomUUID()}`
    const { data: sub, error: insertErr } = await admin
      .from('elite_subscriptions')
      .insert({
        email,
        user_id: userId,
        status: 'pending',
        order_id: orderId,
        amount_usd: elitePkg.price_usd,
        // The IPN stamps expires_at = paid_at + duration_days, so the
        // window the buyer paid for is persisted with the order.
        duration_days: elitePkg.duration_days,
        ...(renew_post_id ? { renew_post_id } : {}),
        pay_currency: 'usdttrc20',
      })
      .select()
      .single()

    if (insertErr || !sub) {
      console.error('[elite-nowpayments] DB insert failed:', insertErr)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // ── Create the NOWPayments payment via the kit (fixed USDT-TRC20) ──
    let session
    try {
      session = await getPaymentsKit().createCheckout({
        provider: 'nowpayments',
        method: 'crypto',
        orderRef: orderId,
        amount: { currency: 'USD', value: elitePkg.price_usd },
        description: `Marketplace Elite — Suscripción (${elitePkg.duration_days} días)`,
        payCurrency: 'usdttrc20',
        payerEmail: email,
      })
    } catch (gatewayErr) {
      console.error('[elite-nowpayments] NOWPayments payment failed:', gatewayErr instanceof Error ? gatewayErr.message : gatewayErr)
      await admin
        .from('elite_subscriptions')
        .update({ status: 'failed' })
        .eq('id', sub.id)
      return NextResponse.json({ error: 'No se pudo crear el pago' }, { status: 502 })
    }

    // Persist gateway correlation data for the webhook + admin trail
    await admin
      .from('elite_subscriptions')
      .update({
        np_payment_id: session.gatewayId,
        pay_address: session.payAddress,
        pay_amount: session.payAmount,
        pay_currency: session.payCurrency || 'usdttrc20',
      })
      .eq('id', sub.id)

    void sendPendingEmails({
      userEmail: email,
      orderId,
      amountUsd: elitePkg.price_usd,
      payAmount: session.payAmount ?? '',
      payAddress: session.payAddress ?? '',
    })

    return NextResponse.json({
      payment_id:   session.gatewayId,
      pay_address:  session.payAddress,
      pay_amount:   session.payAmount,
      pay_currency: session.payCurrency,
      expiration:   session.expiresAt,
      order_id:     orderId,
      subscription_id: sub.id,
    })
  } catch (err) {
    console.error('[elite-nowpayments] unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

async function sendPendingEmails(params: {
  userEmail: string
  orderId: string
  amountUsd: number
  payAmount: number | string
  payAddress: string
}) {
  const { userEmail, orderId, amountUsd, payAmount, payAddress } = params
  await sendEmail({
    to: userEmail,
    subject: 'Elite · Suscripción pendiente de pago',
    html: renderEmail(`
      <h2 style="color:#2563EB;letter-spacing:.08em">Elite · Pendiente de Pago</h2>
      <p>Recibimos tu solicitud de suscripción Elite.</p>
      <p><b>Monto:</b> ${payAmount} USDT (TRC-20) · ~${amountUsd} USD<br/>
         <b>Dirección:</b> <code>${payAddress}</code><br/>
         <b>Orden:</b> ${orderId}</p>
      <p style="font-size:11px;color:#8a8274">Tras la confirmación on-chain (1–3 confirmaciones) recibirás un segundo correo con la activación.</p>
    `),
  })
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `[ADMIN] Elite pendiente — ${userEmail}`,
    html: renderEmail(`
      <h3 style="color:#2563EB">Nueva solicitud Elite (pending)</h3>
      <ul>
        <li><b>Email:</b> ${userEmail}</li>
        <li><b>Order ID:</b> ${orderId}</li>
        <li><b>Monto:</b> ${payAmount} USDT (~${amountUsd} USD)</li>
        <li><b>Dirección:</b> <code>${payAddress}</code></li>
      </ul>
    `),
  })
}
