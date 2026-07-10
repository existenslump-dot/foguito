import { createPaymentsKit, type PaymentsKit } from '@marketplace/payments-kit'

/**
 * App-side factory for the payments kit.
 *
 * The kit (packages/payments-kit) owns all gateway communication: checkout
 * creation, webhook signature verification, payload normalization and
 * reconciliation. THIS app is the consumer side of the seam — it stores
 * orders, claims idempotency (apply_payment_activation) and fulfils
 * `payment.confirmed` events. See packages/payments-kit/README.md.
 *
 * Built per call (cheap object construction) so per-request env in tests and
 * preview deployments is always honored; no module-level cache.
 */
export function getPaymentsKit(): PaymentsKit {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  return createPaymentsKit({
    providers: {
      ...(process.env.MP_ACCESS_TOKEN
        ? {
            mercadopago: {
              accessToken: process.env.MP_ACCESS_TOKEN,
              webhookSecret: process.env.MP_WEBHOOK_SECRET,
              notificationUrl: `${base}/api/pagos/mp/webhook`,
              backUrls: {
                success: `${base}/pagos?status=approved`,
                failure: `${base}/pagos?status=rejected`,
                pending: `${base}/pagos?status=pending`,
              },
              statementDescriptor: 'MARKETPLACE PLUS',
            },
          }
        : {}),
      ...(process.env.NOWPAYMENTS_API_KEY
        ? {
            nowpayments: {
              apiKey: process.env.NOWPAYMENTS_API_KEY,
              ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET,
              ipnCallbackUrl: `${base}/api/webhooks/nowpayments`,
              successUrl: `${base}/pagos/success`,
              cancelUrl: `${base}/pagos`,
            },
          }
        : {}),
    },
    // Local/preview without the real secrets can still iterate; production
    // is fail-closed (missing secret → 5xx, never silent processing).
    allowUnsignedWebhooks: process.env.NODE_ENV !== 'production',
  })
}
