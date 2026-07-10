import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { getOptionalUser } from '@/lib/clients/require-user'
import { getPaymentsKit } from '@/lib/payments/kit'
import { getPackage } from '@/lib/packages'
import { MpPreferenceSchema, validationError } from '@/lib/validation/schemas'
import { PAYMENTS_DISABLED, maintenanceJson } from '@/lib/maintenance'
import { MARKETPLACE, PAYMENTS_ENABLED } from '@/config/marketplace.config'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // Payments is a paid add-on, off by default. When off the route is inert.
  if (!PAYMENTS_ENABLED) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (PAYMENTS_DISABLED) {
    return NextResponse.json(maintenanceJson(), { status: 503 })
  }
  try {
    // Clients are instantiated inside the handler so the build doesn't
    // require production secrets (MP_ACCESS_TOKEN, SUPABASE_SERVICE_ROLE_KEY).
    const admin = getSupabaseAdmin()

    // userId binds the charge to an account so the webhook can activate it
    // automatically. Anonymous checkout (concierge fallback: payment lands
    // without an account and an admin fulfils manually) must be opted into
    // explicitly per deployment.
    const userId = await getOptionalUser(req)
    if (!userId && process.env.PAYMENTS_ALLOW_ANONYMOUS !== 'true') {
      return NextResponse.json(
        { error: 'login_required', message: 'Iniciá sesión para completar el pago.' },
        { status: 401 },
      )
    }

    // Zod parse rejects missing / malformed package_id and enforces the
    // email shape server-side. The client also regex-checks email before
    // POST but that's a UX nicety, not a security boundary.
    const parsed = MpPreferenceSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 })
    }
    const { package_id, payer_email, renew_post_id } = parsed.data

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
      const { data: renewPost } = await admin
        .from('posts').select('user_id').eq('id', renew_post_id).maybeSingle()
      if (!renewPost || renewPost.user_id !== userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Server-authoritative pricing. Previously the client was passing
    // amount_ars / amount_usd / credits in the body and we trusted them —
    // any user could create a Gold preference for $1. The package catalogue
    // is the single source of truth; anything the client sends for amounts
    // is ignored.
    const pkg = getPackage(package_id)
    if (!pkg) {
      return NextResponse.json({ error: 'Unknown package' }, { status: 400 })
    }

    // Smoke-test SKU is admin-only. Without this gate any user could spam
    // $1 preferences against our MP account, leaving a trail of pending
    // operations in the dashboard. We still let the rest of the flow run
    // (DB row inserted, MP preference created) so the test exercises the
    // exact same path real customers take. See /admin/test-payment for
    // the UI entry point.
    if (pkg.id === 'tier_test') {
      if (!userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { data: prof } = await admin
        .from('profiles')
        .select('is_admin')
        .eq('id', userId)
        .single()
      if (!prof?.is_admin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const { data: payment, error: dbError } = await admin
      .from('mp_payments')
      .insert({
        user_id: userId, // null if anonymous (concierge mode)
        package_id: pkg.id,
        amount_ars: pkg.price_local,
        amount_usd: pkg.price_usd,
        credits: pkg.credits,
        status: 'pending',
        // renew_post_id rides the pending row's metadata to the webhook —
        // gateway payloads never carry fulfilment targets.
        metadata: { payer_email: payer_email ?? null, ...(renew_post_id ? { renew_post_id } : {}) },
      })
      .select()
      .single()

    if (dbError) {
      console.error('[MP] insert error:', dbError)
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    // Gateway communication goes through the payments kit — this route only
    // owns order storage and the response shape.
    const session = await getPaymentsKit().createCheckout({
      provider: 'mercadopago',
      method: 'redirect',
      orderRef: payment.id,
      amount: { currency: MARKETPLACE.market.currency, value: pkg.price_local },
      description: `Marketplace — ${pkg.label}`,
      payerEmail: payer_email ?? undefined,
      metadata: { user_id: userId, internal_payment_id: payment.id, payer_email: payer_email ?? null },
    })

    await admin
      .from('mp_payments')
      .update({ mp_preference_id: session.gatewayId })
      .eq('id', payment.id)

    return NextResponse.json({
      preference_id: session.gatewayId,
      internal_id: payment.id,
      redirect_url: session.redirectUrl ?? null,
    })
  } catch (err) {
    console.error('[MP] crear-preferencia error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
