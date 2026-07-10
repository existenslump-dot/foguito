import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { getOptionalUser } from '@/lib/clients/require-user'
import { getPaymentsKit } from '@/lib/payments/kit'
import { sendEmail, ADMIN_EMAIL } from '@/lib/clients/resend'
import { CryptoPaymentSchema, validationError } from '@/lib/validation/schemas'
import { getPackage } from '@/lib/packages'
import { renderEmail } from '@/lib/emails'
import { PAYMENTS_DISABLED, maintenanceJson } from '@/lib/maintenance'
import { PAYMENTS_ENABLED } from '@/config/marketplace.config'

export const runtime = 'nodejs'

/**
 * Create a NOWPayments payment for a tier package.
 *
 * - Pricing is server-authoritative: the package catalogue is the single
 *   source of truth; the client only sends a package_id.
 * - The pending row in `payment_transactions` is written BEFORE returning a
 *   pay address (fail-closed: if we can't record the transaction we refuse
 *   to take the money — otherwise the IPN would arrive for an unknown id
 *   and fulfilment would silently fall to manual handling).
 * - order_id is an opaque uuid reference. The previous scheme
 *   (`{email}_{package}_{timestamp}`) leaked the payer email to the
 *   processor dashboard and was enumerable.
 */
export async function POST(request: Request) {
  // Payments is a paid add-on, off by default. When the feature flag is
  // off the route is fully inert (404) — the add-on doesn't exist in base.
  if (!PAYMENTS_ENABLED) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (PAYMENTS_DISABLED) {
    return NextResponse.json(maintenanceJson(), { status: 503 })
  }
  try {
    const parsed = CryptoPaymentSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 })
    }
    const { package_id, payer_email, currency, renew_post_id } = parsed.data

    // The account that gets credited comes from the SESSION, never from the
    // request body — a body-supplied user_id would let any caller bind the
    // payment to an arbitrary account. Anonymous checkout (manual fulfilment
    // fallback) must be opted into explicitly per deployment.
    const userId = await getOptionalUser(request)
    if (!userId && process.env.PAYMENTS_ALLOW_ANONYMOUS !== 'true') {
      return NextResponse.json(
        { error: 'login_required', message: 'Iniciá sesión para completar el pago.' },
        { status: 401 },
      )
    }

    const pkg = getPackage(package_id)
    if (!pkg) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 })
    }

    // Self-serve renewal: the target must exist and belong to the session
    // user BEFORE we take the money. Activation re-checks ownership
    // atomically, but failing early here beats a paid no-op.
    if (renew_post_id) {
      if (!userId) {
        return NextResponse.json(
          { error: 'login_required', message: 'Iniciá sesión para renovar tu publicación.' },
          { status: 401 },
        )
      }
      const { data: renewPost } = await getSupabaseAdmin()
        .from('posts').select('user_id').eq('id', renew_post_id).maybeSingle()
      if (!renewPost || renewPost.user_id !== userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    if (!process.env.NOWPAYMENTS_API_KEY) {
      console.error('[pagos/crypto] NOWPAYMENTS_API_KEY missing')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const orderRef = `ord_${randomUUID()}`

    // Gateway communication goes through the payments kit; this route owns
    // order storage and fulfilment wiring.
    let session
    try {
      session = await getPaymentsKit().createCheckout({
        provider: 'nowpayments',
        method: 'crypto',
        orderRef,
        amount: { currency: 'USD', value: pkg.price_usd },
        description: `Marketplace — ${pkg.label} — ${pkg.price_usd} USD`,
        payCurrency: currency || 'usdttrc20',
        payerEmail: payer_email ?? undefined,
      })
    } catch (gatewayErr) {
      console.error('[pagos/crypto] NOWPayments error:', gatewayErr instanceof Error ? gatewayErr.message : gatewayErr)
      return NextResponse.json({ error: 'Payment creation failed' }, { status: 502 })
    }

    // Fail-closed: the IPN handler resolves fulfilment from this row. If it
    // can't be written, surface the error instead of handing out an address
    // we can't reconcile.
    const admin = getSupabaseAdmin()
    const { error: insertErr } = await admin.from('payment_transactions').insert({
      gateway:       'nowpayments',
      gateway_tx_id: session.gatewayId,
      order_ref:     orderRef,
      user_id:       userId,
      package_id:    pkg.id,
      credits:       pkg.credits,
      amount_usd:    pkg.price_usd,
      pay_currency:  session.payCurrency || currency || 'usdttrc20',
      status:        'pending',
      payer_email:   payer_email ?? null,
      // renew_post_id rides the pending row's metadata to the IPN handler —
      // gateway payloads never carry fulfilment targets.
      ...(renew_post_id ? { metadata: { renew_post_id } } : {}),
    })
    if (insertErr) {
      console.error('[pagos/crypto] payment_transactions insert failed:', insertErr)
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }

    // Fire-and-forget notifications — admin + payer get an email the moment
    // the payment request is created (not just on confirmation). Failures
    // don't block the response.
    void sendPendingEmails({
      payerEmail: payer_email || null,
      packageLabel: pkg.label,
      amountUsd: pkg.price_usd,
      payAmount: session.payAmount ?? '',
      payAddress: session.payAddress ?? '',
      orderId: orderRef,
      payCurrency: session.payCurrency || 'usdttrc20',
    })

    return NextResponse.json({
      payment_id:   session.gatewayId,
      pay_address:  session.payAddress,
      pay_amount:   session.payAmount,
      pay_currency: session.payCurrency,
      expiration:   session.expiresAt,
    })
  } catch (err) {
    console.error('[pagos/crypto] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

async function sendPendingEmails(params: {
  payerEmail: string | null
  packageLabel: string
  amountUsd: number
  payAmount: number | string
  payAddress: string
  orderId: string
  payCurrency: string
}) {
  const { payerEmail, packageLabel, amountUsd, payAmount, payAddress, orderId, payCurrency } = params
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `[ADMIN] Pago cripto pendiente — ${packageLabel} · ${payerEmail || 'anónimo'}`,
    html: renderEmail(`
      <h3 style="color:#2563EB">Nueva solicitud de pago cripto (pending)</h3>
      <ul>
        <li><b>Plan:</b> ${packageLabel}</li>
        <li><b>Monto:</b> ${amountUsd} USD · ${payAmount} ${payCurrency.toUpperCase()}</li>
        <li><b>Email pagador:</b> ${payerEmail || '(anónimo)'}</li>
        <li><b>Order ID:</b> ${orderId}</li>
        <li><b>Dirección de pago:</b> <code>${payAddress}</code></li>
      </ul>
      <p>El comprador verá el QR + dirección en pantalla. Confirmación y activación automáticas vía IPN cuando la blockchain acuse el pago.</p>
    `),
  })
  if (payerEmail) {
    await sendEmail({
      to: payerEmail,
      subject: `Pago cripto pendiente — ${packageLabel}`,
      html: renderEmail(`
        <h2 style="color:#2563EB;letter-spacing:.08em">${packageLabel} · Pendiente de Pago</h2>
        <p>Recibimos tu solicitud de pago en cripto.</p>
        <p><b>Monto:</b> ${payAmount} ${payCurrency.toUpperCase()} (~${amountUsd} USD)<br/>
           <b>Dirección:</b> <code>${payAddress}</code><br/>
           <b>Orden:</b> ${orderId}</p>
        <p style="font-size:11px;color:#8a8274">No cierres la ventana de pago hasta completar la transferencia. Una vez confirmada en la blockchain, tu plan se activará automáticamente.</p>
      `),
    })
  }
}
