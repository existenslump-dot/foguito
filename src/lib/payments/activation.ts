import type { SupabaseClient } from '@supabase/supabase-js'
import { packageDurationDays, packageTierSlug } from '@/lib/packages'

/**
 * Payment → activation seam.
 *
 * Webhooks (Mercado Pago, NOWPayments) verify + normalize the gateway
 * notification into a `PaymentConfirmedEvent` and hand it here. This module
 * is the ONLY consumer-side fulfilment path: it calls the atomic
 * `apply_payment_activation` SQL function (see the payment_activation
 * migration) which claims the transaction exactly once and grants credits.
 *
 * Keeping the event shape provider-agnostic is deliberate — the payments
 * kit emits `payment.confirmed`; what activation *means* (credits, tiers,
 * subscriptions) belongs to the app, not to the gateway integration.
 */

export type PaymentProvider = 'mercadopago' | 'nowpayments'

export interface PaymentConfirmedEvent {
  provider: PaymentProvider
  /** Provider-side payment id — the durable idempotency key. */
  gatewayTxId: string
  /** Our opaque order reference (uuid-based, non-enumerable). */
  orderRef?: string | null
  packageId: string
  credits: number
  amountUsd: number | null
  userId: string | null
  payerEmail: string | null
  /** Self-serve renewal: post to extend on activation (from the pending
   *  row's metadata — never from the webhook payload). Optional. */
  renewPostId?: string | null
}

export type ActivationResult =
  /** Credits granted to the buyer's profile. */
  | 'applied'
  /** Replay — this gateway tx was already processed. Nothing changed. */
  | 'already-applied'
  /** Payment recorded, but no account to credit (anonymous payer or
   *  profile deleted). Caller must fall back to manual fulfilment. */
  | 'no-user'
  /** RPC failed — caller should NOT confirm fulfilment to the buyer. */
  | 'error'

/**
 * Apply a confirmed payment exactly once. Idempotent under webhook replays
 * (DB-level UNIQUE(gateway, gateway_tx_id) claim). Never throws.
 */
export async function applyPaymentActivation(
  admin: SupabaseClient,
  evt: PaymentConfirmedEvent,
): Promise<ActivationResult> {
  // Duration + tier are derived from the server-authoritative catalogue
  // (src/lib/packages.ts), never from the event: webhooks only relay the
  // package id, and the catalogue is the single source of truth for what
  // that id is worth — same reasoning as prices.
  const { data, error } = await admin.rpc('apply_payment_activation', {
    p_gateway: evt.provider,
    p_gateway_tx_id: evt.gatewayTxId,
    p_user_id: evt.userId,
    p_package_id: evt.packageId,
    p_credits: evt.credits,
    p_amount_usd: evt.amountUsd,
    p_payer_email: evt.payerEmail,
    p_order_ref: evt.orderRef ?? null,
    p_duration_days: packageDurationDays(evt.packageId),
    p_tier: packageTierSlug(evt.packageId),
    p_renew_post_id: evt.renewPostId ?? null,
  })

  if (error) {
    console.error('[payments/activation] rpc failed:', {
      provider: evt.provider,
      gatewayTxId: evt.gatewayTxId,
      error,
    })
    return 'error'
  }

  const result = String(data)
  if (result === 'applied' || result === 'already-applied' || result === 'no-user') {
    return result
  }
  console.error('[payments/activation] unexpected rpc result:', result)
  return 'error'
}
