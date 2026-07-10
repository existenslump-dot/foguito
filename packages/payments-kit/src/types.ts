/**
 * Public types of the payments kit.
 *
 * Design rules:
 *  - The kit is STATELESS: it talks to gateways, verifies webhooks and
 *    normalizes them into typed events. Order storage, idempotency claims
 *    and fulfilment (what a confirmed payment *means*) belong to the
 *    consumer — see `PaymentEvent` and the README's activation recipe.
 *  - Everything is framework-agnostic: `handleWebhook` takes raw body +
 *    headers and returns a status + body, so any HTTP layer (Next.js,
 *    Express, bare node) adapts in two lines.
 */

export type ProviderName = 'mercadopago' | 'nowpayments'

export type CheckoutMethod =
  /** MercadoPago Checkout Pro — hosted redirect (init_point). */
  | 'redirect'
  /** MercadoPago Bricks — client-side card tokenization, server charge. */
  | 'card_token'
  /** MercadoPago PIX (Brazil) — instant QR / copia-e-cola. Requires an
   *  MLB (Brazil) MercadoPago account and BRL amounts. */
  | 'pix'
  /** NOWPayments — on-chain crypto payment (address + amount). */
  | 'crypto'

export interface Money {
  /** ISO-4217 (gateway-side currency: ARS/BRL/etc. for MP, fiat pricing
   *  currency for NOWPayments). */
  currency: string
  value: number
}

export interface CheckoutInput {
  provider: ProviderName
  /** Defaults: mercadopago → 'redirect', nowpayments → 'crypto'. */
  method?: CheckoutMethod
  /** YOUR opaque order reference. The kit threads it through the gateway
   *  (external_reference / order_id) and back out on every event so you can
   *  correlate without storing gateway ids first. Use something
   *  non-enumerable (uuid). */
  orderRef: string
  amount: Money
  description: string
  payerEmail?: string
  /** card_token only — fields produced by the MP Bricks form. */
  card?: {
    token: string
    paymentMethodId: string
    installments?: number
    issuerId?: string
    payerIdentification?: { type: string; number: string }
  }
  /** crypto only — pay currency (default usdttrc20). */
  payCurrency?: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface CheckoutSession {
  provider: ProviderName
  method: CheckoutMethod
  /** Gateway-side id of what was created: MP preference id (redirect),
   *  MP payment id (pix / card_token), NOWPayments payment id (crypto). */
  gatewayId: string
  orderRef: string
  /** redirect: hosted checkout URL (MP init_point). */
  redirectUrl?: string
  /** pix: QR payload (copia-e-cola) + optional base64 PNG. */
  qr?: { code: string; base64?: string; ticketUrl?: string }
  /** crypto: where and how much to pay on-chain. */
  payAddress?: string
  payAmount?: number | string
  payCurrency?: string
  /** card_token: immediate gateway verdict for the charge attempt. */
  status?: PaymentEventType
  statusDetail?: string
  expiresAt?: string
  /** Raw gateway response — for logging/debugging, never for trust
   *  decisions (use reconcile / webhook events for those). */
  raw: unknown
}

export type PaymentEventType =
  /** Money is confirmed at the gateway. Safe to fulfil — after YOUR
   *  amount/idempotency checks (see README). */
  | 'payment.confirmed'
  | 'payment.pending'
  | 'payment.failed'
  | 'payment.expired'
  | 'payment.partially_paid'
  | 'payment.refunded'
  | 'payment.unknown'

export interface PaymentEvent {
  type: PaymentEventType
  provider: ProviderName
  /** Gateway payment id — use as your idempotency key. */
  gatewayTxId: string
  /** Your orderRef, echoed back by the gateway (null if it didn't carry one). */
  orderRef: string | null
  /** GATEWAY-VERIFIED amount. For MercadoPago this is re-fetched from the
   *  Payments API — never read from the webhook payload — so you can compare
   *  it against the amount you stored at checkout time (fraud check). */
  amount: Money | null
  payerEmail: string | null
  /** Raw provider status string ('approved', 'finished', …). */
  providerStatus: string
  raw: unknown
}

export interface WebhookRequest {
  /** Raw request body EXACTLY as received (signatures cover the bytes). */
  rawBody: string
  /** Header lookup — pass a function or a plain lower-cased record. */
  headers: Record<string, string | null | undefined> | ((name: string) => string | null)
}

export type WebhookResult =
  | {
      ok: true
      /** HTTP status to respond with. */
      status: number
      /** Normalized event, or null for acks that carry no event (e.g. a
       *  non-payment notification type). */
      event: PaymentEvent | null
      body: Record<string, unknown>
    }
  | {
      ok: false
      status: number
      error: string
      body: Record<string, unknown>
    }

export interface ReconcileResult {
  provider: ProviderName
  gatewayTxId: string
  /** Normalized from gateway truth (a fresh API read, never cached). */
  status: PaymentEventType
  providerStatus: string
  amount: Money | null
  orderRef: string | null
  payerEmail: string | null
  raw: unknown
}

/** Contract every provider implements. Adding a provider = implementing
 *  this interface and registering it in the kit config — the core and the
 *  consumers don't change. */
export interface PaymentProviderAdapter {
  readonly name: ProviderName
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>
  handleWebhook(req: WebhookRequest): Promise<WebhookResult>
  reconcile(gatewayTxId: string): Promise<ReconcileResult>
}

// ── Kit configuration ──────────────────────────────────────────────────────

export interface MercadoPagoConfig {
  accessToken: string
  /** HMAC secret for webhook x-signature verification. Required unless
   *  `allowUnsignedWebhooks` (dev only) is set. */
  webhookSecret?: string
  /** Where MP should notify (absolute URL). */
  notificationUrl?: string
  backUrls?: { success?: string; failure?: string; pending?: string }
  statementDescriptor?: string
}

export interface NowPaymentsConfig {
  apiKey: string
  /** HMAC secret for IPN x-nowpayments-sig verification. Required unless
   *  `allowUnsignedWebhooks` (dev only) is set. */
  ipnSecret?: string
  ipnCallbackUrl?: string
  successUrl?: string
  cancelUrl?: string
}

export interface PaymentsKitConfig {
  providers: {
    mercadopago?: MercadoPagoConfig
    nowpayments?: NowPaymentsConfig
  }
  /** DEV ONLY: accept webhooks without a configured secret. The kit is
   *  fail-closed by default — production must configure secrets. */
  allowUnsignedWebhooks?: boolean
  /** Optional hook invoked with every normalized event handleWebhook
   *  produces — convenient single place to wire fulfilment. */
  onPaymentEvent?: (event: PaymentEvent) => void | Promise<void>
}

export interface PaymentsKit {
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>
  handleWebhook(provider: ProviderName, req: WebhookRequest): Promise<WebhookResult>
  reconcile(provider: ProviderName, gatewayTxId: string): Promise<ReconcileResult>
  /** The configured provider adapters (introspection / advanced use). */
  providers: Partial<Record<ProviderName, PaymentProviderAdapter>>
}
