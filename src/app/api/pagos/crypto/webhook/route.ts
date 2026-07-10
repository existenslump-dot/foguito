/**
 * Legacy NOWPayments IPN URL — kept alive because in-flight payments created
 * before the webhook unification registered this `ipn_callback_url`. New
 * payments point at /api/webhooks/nowpayments; both delegate to the same
 * unified handler.
 */
import { NextResponse } from 'next/server'
import { handleNowPaymentsIpn } from '@/lib/payments/nowpayments-webhook'
import { PAYMENTS_ENABLED } from '@/config/marketplace.config'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  // Payments is a paid add-on, off by default. In the base product there are
  // no in-flight payments, so the IPN is inert (404) when the flag is off.
  if (!PAYMENTS_ENABLED) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  return handleNowPaymentsIpn(req)
}
