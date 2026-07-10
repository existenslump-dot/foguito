import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { sendEmail, ADMIN_EMAIL } from '@/lib/clients/resend'
import { getPaymentsKit } from '@/lib/payments/kit'
import { applyPaymentActivation } from '@/lib/payments/activation'
import { PAYMENTS_ENABLED } from '@/config/marketplace.config'

export const runtime = 'nodejs'

/**
 * MercadoPago webhook — thin adapter over the payments kit.
 *
 * The kit verifies the x-signature HMAC (fail-closed in production) and
 * re-fetches the payment from MP's API, emitting a typed event whose
 * amount/status are GATEWAY TRUTH (never the webhook payload). This route
 * owns the consumer side: order lookup, the terminal-status state machine,
 * the amount fraud check against what we recorded at checkout time, and
 * exactly-once activation.
 */

// Known MP payment statuses that count as terminal — once reached, we
// refuse to overwrite with a later (possibly out-of-order) webhook.
const TERMINAL_STATUSES = new Set(['approved', 'rejected', 'cancelled', 'refunded', 'charged_back'])

export async function POST(req: NextRequest) {
  // Payments is a paid add-on, off by default. In the base product there are
  // no in-flight payments, so the webhook is inert (404) when the flag is off.
  if (!PAYMENTS_ENABLED) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const admin = getSupabaseAdmin()

  try {
    const rawBody = await req.text()
    const kitResult = await getPaymentsKit().handleWebhook('mercadopago', {
      rawBody,
      headers: (name) => req.headers.get(name),
    })

    if (!kitResult.ok) {
      console.error('[MP webhook] kit rejected:', kitResult.error)
      return NextResponse.json(kitResult.body, { status: kitResult.status })
    }

    const event = kitResult.event
    // Non-payment notification types (merchant_order etc.) carry no event.
    if (!event) {
      return NextResponse.json(kitResult.body)
    }

    const internalPaymentId = event.orderRef
    if (!internalPaymentId) {
      return NextResponse.json({ received: true })
    }

    const { data: payment } = await admin
      .from('mp_payments')
      .select('*')
      .eq('id', internalPaymentId)
      .single()

    if (!payment) {
      console.error('[MP webhook] unknown internal payment id:', internalPaymentId)
      return NextResponse.json({ received: true })
    }

    // Verbose dump for the smoke-test SKU (admin QA) — see /admin/test-payment.
    if (payment.package_id === 'tier_test') {
      console.log('[MP webhook][tier_test] event:', JSON.stringify(event, null, 2))
    }

    // ── State-machine guard ────────────────────────────────────────────
    // Once a payment reaches a terminal status we freeze it. A later
    // webhook claiming a different final state (or dropping it back to
    // "pending") is ignored. Idempotent for replays of the same status.
    if (TERMINAL_STATUSES.has(payment.status)) {
      return NextResponse.json({ received: true, note: 'already-final' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawPayment = event.raw as any
    const status = event.providerStatus
    const paymentId = event.gatewayTxId

    // ── Amount re-verification ─────────────────────────────────────────
    // event.amount is gateway truth (kit re-fetched it). Compare against
    // what OUR catalogue recorded at preference time — a mismatch means a
    // tampered/compromised preference and must never activate.
    const mpAmount = Number(event.amount?.value ?? 0)
    const dbAmount = Number(payment.amount_ars ?? 0)
    if (status === 'approved' && Math.abs(mpAmount - dbAmount) > 0.01) {
      console.error('[MP webhook] amount mismatch — refusing to approve', {
        internalPaymentId,
        mpAmount,
        dbAmount,
      })
      await admin
        .from('mp_payments')
        .update({
          status: 'rejected',
          mp_payment_id: paymentId,
          updated_at: new Date().toISOString(),
          metadata: {
            ...((payment.metadata as object) ?? {}),
            amount_mismatch: { mpAmount, dbAmount },
          },
        })
        .eq('id', internalPaymentId)
      return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 })
    }

    await admin
      .from('mp_payments')
      .update({
        status,
        mp_payment_id: paymentId,
        updated_at: new Date().toISOString(),
        metadata: {
          ...((payment.metadata as object) ?? {}),
          mp_status_detail: rawPayment?.status_detail,
          payment_method: rawPayment?.payment_method_id,
          payer_email: event.payerEmail,
        },
      })
      .eq('id', internalPaymentId)

    if (event.type === 'payment.confirmed') {
      const payerEmail =
        event.payerEmail
        || (payment.metadata as { payer_email?: string } | null)?.payer_email
        || null

      // ── Automatic fulfilment ───────────────────────────────────────────
      // Exactly-once credit grant via the apply_payment_activation RPC
      // (UNIQUE(gateway, gateway_tx_id) claim — replay-safe). 'no-user'
      // means an anonymous payer: payment is recorded, admin fulfils
      // manually (the email below says which case we're in).
      const activation = await applyPaymentActivation(admin, {
        provider: 'mercadopago',
        gatewayTxId: paymentId,
        orderRef: internalPaymentId,
        packageId: payment.package_id,
        credits: Number(payment.credits ?? 0),
        amountUsd: payment.amount_usd != null ? Number(payment.amount_usd) : null,
        userId: payment.user_id ?? null,
        payerEmail,
        // From OUR pending row (stamped at preference time), not the gateway.
        renewPostId: (payment.metadata as { renew_post_id?: string } | null)?.renew_post_id ?? null,
      })

      const fulfilmentLine =
        activation === 'applied'
          ? 'Tu plan ya está activo en tu cuenta.'
          : activation === 'already-applied'
            ? 'Tu plan ya estaba activo en tu cuenta.'
            : 'Nuestro equipo activará tu plan a la brevedad.'

      const subject = `Pago confirmado — Marketplace (${payment.package_id})`
      const html = `
        <div style="font-family:sans-serif;background:#0F172A;color:#E2E8F0;padding:32px">
          <h2 style="color:#2563EB">Pago Confirmado</h2>
          <p>Recibimos tu pago correctamente.</p>
          <p><b>Plan:</b> ${payment.package_id}</p>
          <p><b>Monto:</b> ${payment.amount_usd} USD (${payment.amount_ars} ${payment.currency || 'ARS'})</p>
          <p><b>Método:</b> Mercado Pago</p>
          <p><b>ID transacción:</b> ${paymentId}</p>
          <p><b>Email comprador:</b> ${payerEmail || '(no informado)'}</p>
          <p style="margin-top:24px">${fulfilmentLine}</p>
        </div>
      `
      const recipients = [ADMIN_EMAIL, payerEmail].filter(Boolean) as string[]
      if (recipients.length > 0) {
        await sendEmail({ to: recipients, subject, html })
      }

      // Manual-fulfilment fallback needs an explicit admin heads-up;
      // 'error' additionally means the buyer was charged but nothing was
      // activated — that must never go unnoticed.
      if (activation === 'no-user' || activation === 'error') {
        await sendEmail({
          to: ADMIN_EMAIL,
          subject: `[ACCIÓN REQUERIDA] Activación manual MP ${paymentId} (${activation})`,
          html: `
            <p>Pago MP aprobado sin activación automática (<b>${activation}</b>).</p>
            <p>Plan: ${payment.package_id} · Tx: ${paymentId} · Email: ${payerEmail || '(anónimo)'}</p>
          `,
        })
      }
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[MP] webhook error:', err)
    return NextResponse.json({ received: true })
  }
}
