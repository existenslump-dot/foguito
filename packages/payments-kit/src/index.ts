/**
 * @marketplace/payments-kit — provider-agnostic LATAM payments.
 *
 * Public surface:
 *   createPaymentsKit(config) → { createCheckout, handleWebhook, reconcile }
 *
 * Providers: MercadoPago (redirect / card_token / pix) and NOWPayments
 * (crypto). The kit verifies webhooks, normalizes them into typed
 * `PaymentEvent`s (`payment.confirmed` et al) and stays STATELESS —
 * idempotency claims and fulfilment live in the consumer.
 */
export { createPaymentsKit } from './kit.ts'
export { createMercadoPagoAdapter } from './providers/mercadopago.ts'
export { createNowPaymentsAdapter } from './providers/nowpayments.ts'
export { verifyMercadoPagoSignature, verifyNowPaymentsSignature } from './signatures.ts'
export type {
  CheckoutInput,
  CheckoutMethod,
  CheckoutSession,
  MercadoPagoConfig,
  Money,
  NowPaymentsConfig,
  PaymentEvent,
  PaymentEventType,
  PaymentProviderAdapter,
  PaymentsKit,
  PaymentsKitConfig,
  ProviderName,
  ReconcileResult,
  WebhookRequest,
  WebhookResult,
} from './types.ts'
export type { SignatureVerdict } from './signatures.ts'
