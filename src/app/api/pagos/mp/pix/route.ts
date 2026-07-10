import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { getOptionalUser } from '@/lib/clients/require-user'
import { getPaymentsKit } from '@/lib/payments/kit'
import { getPackage } from '@/lib/packages'
import { MpPreferenceSchema, validationError } from '@/lib/validation/schemas'
import { PAYMENTS_DISABLED, maintenanceJson } from '@/lib/maintenance'
import { MARKETPLACE, PAYMENTS_ENABLED } from '@/config/marketplace.config'

export const runtime = 'nodejs'

/**
 * PIX checkout (Brazil) — instant QR payment via MercadoPago.
 *
 * Availability is config-driven: PIX requires an MLB (Brazil) MercadoPago
 * account and BRL amounts, so the route only operates when the deployment's
 * market currency is BRL. Confirmation arrives on the same MP webhook as
 * every other MP payment (external_reference = our row id) and activates
 * automatically through apply_payment_activation.
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
    if (MARKETPLACE.market.currency !== 'BRL') {
      return NextResponse.json(
        { error: 'pix_unavailable', message: 'PIX requiere un deployment con moneda BRL (cuenta MercadoPago de Brasil).' },
        { status: 400 },
      )
    }

    const admin = getSupabaseAdmin()
    const userId = await getOptionalUser(req)
    if (!userId && process.env.PAYMENTS_ALLOW_ANONYMOUS !== 'true') {
      return NextResponse.json(
        { error: 'login_required', message: 'Iniciá sesión para completar el pago.' },
        { status: 401 },
      )
    }

    const parsed = MpPreferenceSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 })
    }
    const { package_id, payer_email } = parsed.data

    // PIX requires a payer email on the gateway side.
    if (!payer_email) {
      return NextResponse.json({ error: 'payer_email requerido para PIX' }, { status: 400 })
    }

    const pkg = getPackage(package_id)
    if (!pkg || pkg.adminOnly) {
      return NextResponse.json({ error: 'Unknown package' }, { status: 400 })
    }

    const { data: payment, error: dbError } = await admin
      .from('mp_payments')
      .insert({
        user_id: userId,
        package_id: pkg.id,
        amount_ars: pkg.price_local, // column name is historical; value is in market currency (BRL here)
        amount_usd: pkg.price_usd,
        credits: pkg.credits,
        currency: MARKETPLACE.market.currency,
        status: 'pending',
        metadata: { payer_email, method: 'pix' },
      })
      .select()
      .single()

    if (dbError) {
      console.error('[MP pix] insert error:', dbError)
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    let session
    try {
      session = await getPaymentsKit().createCheckout({
        provider: 'mercadopago',
        method: 'pix',
        orderRef: payment.id,
        amount: { currency: MARKETPLACE.market.currency, value: pkg.price_local },
        description: `Marketplace — ${pkg.label}`,
        payerEmail: payer_email,
        metadata: { user_id: userId, internal_payment_id: payment.id },
      })
    } catch (gatewayErr) {
      console.error('[MP pix] gateway error:', gatewayErr instanceof Error ? gatewayErr.message : gatewayErr)
      await admin.from('mp_payments').update({ status: 'cancelled' }).eq('id', payment.id)
      return NextResponse.json({ error: 'Payment creation failed' }, { status: 502 })
    }

    await admin
      .from('mp_payments')
      .update({ mp_payment_id: session.gatewayId })
      .eq('id', payment.id)

    return NextResponse.json({
      internal_id: payment.id,
      payment_id: session.gatewayId,
      qr_code: session.qr?.code ?? null,
      qr_code_base64: session.qr?.base64 ?? null,
      ticket_url: session.qr?.ticketUrl ?? null,
      expires_at: session.expiresAt ?? null,
    })
  } catch (err) {
    console.error('[MP pix] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
