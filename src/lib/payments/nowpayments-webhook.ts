import { NextResponse } from 'next/server'
import type { PaymentEvent } from '@marketplace/payments-kit'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { sendEmail, ADMIN_EMAIL } from '@/lib/clients/resend'
import { renderEmail } from '@/lib/emails'
import { getPaymentsKit } from '@/lib/payments/kit'
import { applyPaymentActivation } from '@/lib/payments/activation'

/**
 * Unified NOWPayments IPN handler — consumer side of the payments kit.
 *
 * The kit verifies the IPN signature (HMAC-SHA512 over sorted-key JSON,
 * fail-closed in production) and normalizes the payload into a typed
 * `PaymentEvent`. This module owns fulfilment: order routing (tier credits
 * vs Elite subscriptions), idempotency claims and emails.
 *
 * Both webhook URLs (/api/webhooks/nowpayments and the legacy
 * /api/pagos/crypto/webhook) delegate here so in-flight payments created
 * before the unification still get their IPN delivered.
 */
export async function handleNowPaymentsIpn(request: Request): Promise<NextResponse> {
  try {
    const rawBody = await request.text()
    const kitResult = await getPaymentsKit().handleWebhook('nowpayments', {
      rawBody,
      headers: (name) => request.headers.get(name),
    })

    if (!kitResult.ok) {
      console.error('[nowpayments/ipn] kit rejected:', kitResult.error)
      return NextResponse.json(kitResult.body, { status: kitResult.status })
    }
    const event = kitResult.event
    if (!event) {
      return NextResponse.json(kitResult.body)
    }

    // Elite subscriptions ride the same IPN endpoint; their order refs are
    // prefixed (`elite_<uuid>` — legacy rows used `elite-<email>-<ts>`).
    if (event.orderRef?.startsWith('elite')) {
      return handleEliteIpn(event)
    }
    return handleTierIpn(event)
  } catch (err) {
    console.error('[nowpayments/ipn] unexpected error:', err)
    return NextResponse.json({ error: 'Webhook error' }, { status: 500 })
  }
}

// ── Tier payments (credits) ────────────────────────────────────────────────

const TIER_TERMINAL_FAILURES = new Set(['payment.failed', 'payment.expired', 'payment.partially_paid'])

async function handleTierIpn(event: PaymentEvent): Promise<NextResponse> {
  const admin = getSupabaseAdmin()

  // Non-final progress updates: acknowledge so NOWPayments doesn't retry.
  if (event.type !== 'payment.confirmed' && !TIER_TERMINAL_FAILURES.has(event.type)) {
    return NextResponse.json({ ok: true, status: event.providerStatus })
  }

  // The pending row was created at checkout time (fail-closed: checkout
  // refuses to hand out a pay address it couldn't record). An unknown id
  // is either a stray retry for a foreign environment or tampering — log,
  // alert, and 200 so NOWPayments stops retrying.
  const { data: tx } = await admin
    .from('payment_transactions')
    .select('*')
    .eq('gateway', 'nowpayments')
    .eq('gateway_tx_id', event.gatewayTxId)
    .single()

  if (!tx) {
    console.error('[nowpayments/ipn] unknown payment_id:', event.gatewayTxId)
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `[ALERTA] IPN cripto sin transacción conocida (${event.gatewayTxId})`,
      html: renderEmail(`<p>Llegó un IPN firmado para el pago <code>${event.gatewayTxId}</code> (status: ${event.providerStatus}) pero no existe transacción registrada.</p>`),
    })
    return NextResponse.json({ ok: true, warn: 'unknown payment' })
  }

  if (TIER_TERMINAL_FAILURES.has(event.type)) {
    // Stamp the failure only while pending — never demote a completed tx.
    await admin
      .from('payment_transactions')
      .update({ status: event.providerStatus })
      .eq('id', tx.id)
      .eq('status', 'pending')
    return NextResponse.json({ ok: true, status: event.providerStatus })
  }

  // payment.confirmed → exactly-once activation.
  const activation = await applyPaymentActivation(admin, {
    provider: 'nowpayments',
    gatewayTxId: event.gatewayTxId,
    orderRef: tx.order_ref ?? null,
    packageId: tx.package_id,
    credits: Number(tx.credits ?? 0),
    amountUsd: tx.amount_usd != null ? Number(tx.amount_usd) : null,
    userId: tx.user_id ?? null,
    payerEmail: tx.payer_email ?? null,
    // From OUR pending row (stamped at checkout time), not the IPN payload.
    renewPostId: (tx.metadata as { renew_post_id?: string } | null)?.renew_post_id ?? null,
  })

  if (activation === 'already-applied') {
    return NextResponse.json({ ok: true, already: 'completed' })
  }
  if (activation === 'error') {
    // Tell NOWPayments to retry — the grant didn't happen.
    return NextResponse.json({ error: 'Activation failed' }, { status: 500 })
  }

  const fulfilmentLine =
    activation === 'applied'
      ? 'Tu plan ya está activo en tu cuenta.'
      : 'Nuestro equipo activará tu plan a la brevedad.'

  const recipients = [ADMIN_EMAIL, tx.payer_email].filter(Boolean) as string[]
  if (recipients.length > 0) {
    await sendEmail({
      to: recipients,
      subject: `Pago confirmado — Marketplace (${tx.package_id})`,
      html: renderEmail(`
        <h2 style="color:#2563EB">Pago Confirmado</h2>
        <p>Recibimos tu pago en cripto.</p>
        <p><b>Plan:</b> ${tx.package_id}<br/>
           <b>Monto:</b> ${tx.amount_usd ?? '—'} USD<br/>
           <b>ID transacción:</b> ${event.gatewayTxId}</p>
        <p style="margin-top:24px">${fulfilmentLine}</p>
      `),
    })
  }

  if (activation === 'no-user') {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `[ACCIÓN REQUERIDA] Activación manual cripto ${event.gatewayTxId}`,
      html: renderEmail(`
        <p>Pago cripto confirmado sin cuenta asociada — activación manual.</p>
        <p>Plan: ${tx.package_id} · Tx: ${event.gatewayTxId} · Email: ${tx.payer_email || '(anónimo)'}</p>
      `),
    })
  }

  return NextResponse.json({ ok: true, activation })
}

// ── Elite subscriptions ────────────────────────────────────────────────────

// Fallback for rows created before duration_days existed on the table.
const ELITE_DEFAULT_PERIOD_DAYS = 30

async function handleEliteIpn(event: PaymentEvent): Promise<NextResponse> {
  const admin = getSupabaseAdmin()

  const { data: sub, error: lookupErr } = await admin
    .from('elite_subscriptions')
    .select('*')
    .eq('order_id', event.orderRef as string)
    .single()

  if (lookupErr || !sub) {
    console.error('[nowpayments/ipn] elite subscription not found:', event.orderRef, lookupErr)
    // 200 — NOWPayments retries on non-2xx and there's no row to update.
    return NextResponse.json({ ok: true, warn: 'subscription not found' })
  }

  if (sub.status === 'active') {
    return NextResponse.json({ ok: true, already: 'active' })
  }

  if (event.type !== 'payment.confirmed') {
    // Keep the trail: stamp payment_id (and terminal failures) while pending.
    await admin
      .from('elite_subscriptions')
      .update({
        np_payment_id: event.gatewayTxId,
        ...(TIER_TERMINAL_FAILURES.has(event.type) ? { status: 'failed' } : {}),
      })
      .eq('id', sub.id)
      .eq('status', 'pending')
    return NextResponse.json({ ok: true, status: event.providerStatus })
  }

  // ── Activate: window = the duration the order was created with ──
  // The status guard (eq 'pending') makes concurrent replays a no-op: only
  // one update transitions pending → active.
  const durationDays = Number(sub.duration_days) > 0
    ? Number(sub.duration_days)
    : ELITE_DEFAULT_PERIOD_DAYS
  const paidAt = new Date()
  const expiresAt = new Date(paidAt.getTime() + durationDays * 24 * 60 * 60 * 1000)

  const { data: updated, error: updateErr } = await admin
    .from('elite_subscriptions')
    .update({
      status: 'active',
      paid_at: paidAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      np_payment_id: event.gatewayTxId,
    })
    .eq('id', sub.id)
    .eq('status', 'pending')
    .select()

  if (updateErr) {
    console.error('[nowpayments/ipn] elite activation failed:', updateErr)
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ ok: true, already: 'active' })
  }

  // Self-serve renewal: extend the paid post. Ownership was checked at
  // order time; re-check here (the post may have changed hands via admin
  // tooling between order and confirmation). Exactly-once: the
  // pending→active guard above already filtered replays. A failed
  // extension never blocks the activation — it's logged for the admin.
  if (sub.renew_post_id && sub.user_id) {
    const { data: renewPost } = await admin
      .from('posts').select('user_id, expires_at').eq('id', sub.renew_post_id).maybeSingle()
    if (renewPost && renewPost.user_id === sub.user_id) {
      const base = Math.max(
        renewPost.expires_at ? new Date(renewPost.expires_at).getTime() : 0,
        paidAt.getTime(),
      )
      const { error: renewErr } = await admin
        .from('posts')
        .update({
          expires_at: new Date(base + durationDays * 24 * 60 * 60 * 1000).toISOString(),
          notified_5d: false,
          notified_1d: false,
        })
        .eq('id', sub.renew_post_id)
      if (renewErr) {
        console.error('[nowpayments/ipn] elite renewal extension failed:', renewErr)
      }
    }
  }

  // Mirror the regular flow: record the subscription so post publication
  // resolves this buyer's real duration. Replays can't get here (the
  // pending→active guard above returns early), so a plain insert is safe;
  // a failure is logged but never blocks the activation response — the
  // elite_subscriptions row above is already the source of truth.
  if (sub.user_id) {
    const { error: subErr } = await admin.from('user_subscriptions').insert({
      user_id: sub.user_id,
      package_id: durationDays === 15 ? 'tier_elite_15d' : 'tier_elite',
      tier: 'elite',
      duration_days: durationDays,
      started_at: paidAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: 'active',
      gateway: 'nowpayments',
      gateway_tx_id: event.gatewayTxId,
    })
    if (subErr) {
      console.error('[nowpayments/ipn] user_subscriptions insert failed:', subErr)
    }
  }

  void sendEliteConfirmedEmails({
    userEmail: sub.email,
    comprobanteEmail: sub.comprobante_email ?? null,
    expiresAt: expiresAt.toISOString(),
    orderId: String(event.orderRef),
    paymentId: event.gatewayTxId,
  })

  return NextResponse.json({ success: true })
}

async function sendEliteConfirmedEmails(params: {
  userEmail: string
  comprobanteEmail: string | null
  expiresAt: string
  orderId: string
  paymentId: string
}) {
  const { userEmail, comprobanteEmail, expiresAt, orderId, paymentId } = params
  const expiresFormatted = new Date(expiresAt).toLocaleDateString('es-AR', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  await sendEmail({
    to: [userEmail, ...(comprobanteEmail ? [comprobanteEmail] : [])],
    subject: '✅ Elite · Suscripción Activada',
    html: renderEmail(`
      <h2 style="color:#2563EB;letter-spacing:.08em">Elite · Activa</h2>
      <p>Tu pago fue confirmado y tu suscripción Elite está activa.</p>
      <p><b>Válida hasta:</b> ${expiresFormatted}<br/>
         <b>Orden:</b> ${orderId}<br/>
         <b>Pago:</b> ${paymentId}</p>
    `),
  })
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `[CONFIRMADO] Elite — ${userEmail}`,
    html: renderEmail(`
      <h3 style="color:#2563EB">Elite ACTIVADA</h3>
      <ul>
        <li><b>Email:</b> ${userEmail}</li>
        <li><b>Comprobante a:</b> ${comprobanteEmail || '(no informado)'}</li>
        <li><b>Orden:</b> ${orderId}</li>
        <li><b>Payment ID:</b> ${paymentId}</li>
        <li><b>Vence:</b> ${expiresFormatted}</li>
      </ul>
    `),
  })
}
