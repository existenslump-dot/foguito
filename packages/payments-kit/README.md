# @marketplace/payments-kit

Provider-agnostic **LATAM payments** for Node/TypeScript: **MercadoPago**
(Checkout Pro redirect, Bricks card token, **PIX**) and **NOWPayments**
(crypto) behind one interface:

```
createPaymentsKit(config) → { createCheckout, handleWebhook, reconcile }
```

The kit talks to the gateways, **verifies webhook signatures** (fail-closed)
and normalizes everything into typed `PaymentEvent`s — `payment.confirmed`,
`payment.pending`, `payment.failed`, `payment.expired`,
`payment.partially_paid`, `payment.refunded`. It is **stateless and
framework-agnostic**: order storage, idempotency and fulfilment live in your
app (see [the activation recipe](#the-activation-recipe)); any HTTP layer
adapts in two lines.

## Quickstart (≈5 minutes)

```bash
npm install        # from this package directory
npm run build
NOWPAYMENTS_API_KEY=demo NOWPAYMENTS_IPN_SECRET=demo-secret npm run demo
# → http://localhost:8787  (boots with NO env too; providers show as disabled)
```

In a second terminal, send a **real signed IPN** end-to-end without any
gateway account:

```bash
npm run demo:webhook                      # 'finished' → payment.confirmed
npm run demo:webhook -- --status waiting  # → payment.pending
```

Watch the server log print the normalized event. With real credentials
(`MP_ACCESS_TOKEN`, `NOWPAYMENTS_API_KEY`) the same page creates live
Checkout Pro preferences, PIX QRs and crypto payments.

## Usage

```ts
import { createPaymentsKit } from '@marketplace/payments-kit'

const kit = createPaymentsKit({
  providers: {
    mercadopago: {
      accessToken: process.env.MP_ACCESS_TOKEN!,
      webhookSecret: process.env.MP_WEBHOOK_SECRET, // required in prod (fail-closed)
      notificationUrl: 'https://your.app/api/webhooks/mercadopago',
      backUrls: { success: 'https://your.app/pay?ok', failure: 'https://your.app/pay?ko' },
    },
    nowpayments: {
      apiKey: process.env.NOWPAYMENTS_API_KEY!,
      ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET,
      ipnCallbackUrl: 'https://your.app/api/webhooks/nowpayments',
    },
  },
  onPaymentEvent: async (event) => {
    if (event.type === 'payment.confirmed') await fulfil(event) // your code
  },
})
```

### Checkout — the four shapes

```ts
// MercadoPago Checkout Pro (hosted redirect)
const s = await kit.createCheckout({
  provider: 'mercadopago', method: 'redirect',
  orderRef: crypto.randomUUID(),               // YOUR opaque, non-enumerable ref
  amount: { currency: 'ARS', value: 2500 },
  description: 'Gold plan',
})
// → s.redirectUrl (init_point)

// MercadoPago PIX (Brazil — requires an MLB account + BRL)
const pix = await kit.createCheckout({
  provider: 'mercadopago', method: 'pix',
  orderRef: crypto.randomUUID(),
  amount: { currency: 'BRL', value: 49.9 },
  description: 'Plano Ouro',
  payerEmail: 'buyer@example.com',             // required for PIX
})
// → pix.qr.code (copia-e-cola), pix.qr.base64 (PNG), pix.qr.ticketUrl

// MercadoPago Bricks (card token produced client-side by the Brick)
const card = await kit.createCheckout({
  provider: 'mercadopago', method: 'card_token',
  orderRef, amount: { currency: 'ARS', value: 2500 }, description: 'Gold plan',
  card: { token, paymentMethodId, installments: 1 },
})
// → card.status ('payment.confirmed' | 'payment.failed' | …), card.statusDetail

// NOWPayments crypto
const np = await kit.createCheckout({
  provider: 'nowpayments', method: 'crypto',
  orderRef, amount: { currency: 'USD', value: 20 },
  description: 'Gold plan', payCurrency: 'usdttrc20',
})
// → np.payAddress, np.payAmount, np.payCurrency, np.expiresAt
```

### Webhooks — two-line adapters

```ts
// Next.js App Router
export async function POST(req: Request) {
  const result = await kit.handleWebhook('mercadopago', {
    rawBody: await req.text(),
    headers: (n) => req.headers.get(n),
  })
  return Response.json(result.body, { status: result.status })
}

// Express (with raw body available)
app.post('/webhooks/nowpayments', async (req, res) => {
  const result = await kit.handleWebhook('nowpayments', { rawBody: req.rawBody, headers: req.headers })
  res.status(result.status).json(result.body)
})
```

`handleWebhook` verifies the signature (MercadoPago `x-signature`
HMAC-SHA256; NOWPayments `x-nowpayments-sig` HMAC-SHA512 over sorted-key
JSON, both constant-time), normalizes the payload and invokes
`onPaymentEvent`. Invalid signature → `{ ok: false, status: 401 }`. For
MercadoPago the event **amount is re-fetched from the Payments API** — never
read from the webhook body — so you can compare it against the amount you
stored at checkout time.

### Reconcile

```ts
const truth = await kit.reconcile('mercadopago', gatewayTxId)
// fresh gateway read → { status, amount, orderRef, … } — for cron sweeps of
// stale pending orders or manual dispute checks.
```

## The activation recipe

The kit is stateless **by design** — `payment.confirmed` means "money is
confirmed at the gateway", not "fulfil blindly". Your consumer should:

1. **Store** an order row at checkout time (your `orderRef`, the expected
   amount, the buyer).
2. On `payment.confirmed`: **claim idempotently** — e.g. an
   `INSERT … ON CONFLICT (gateway, gateway_tx_id) DO NOTHING` ledger row, or
   an atomic `pending → completed` transition. If the claim didn't happen,
   stop (replay or out-of-order delivery).
3. **Verify the amount** (`event.amount`) against what you stored.
4. Fulfil (credits, subscription, unlock) inside the same transaction as the
   claim when possible.

The marketplace-starter app implements exactly this with a single SQL
function (`apply_payment_activation`) — see
`supabase/migrations/*payment_activation.sql` in the repo root for a
copy-paste reference.

## Security model

- **Fail-closed**: a provider with no webhook secret rejects webhooks unless
  you explicitly set `allowUnsignedWebhooks: true` (dev/demo only).
- Signatures are verified over the **raw request bytes** with constant-time
  comparison.
- Amounts in events come from gateway API reads (MP) or the signed body (NP),
  never from attacker-controllable fields alone.
- `orderRef` is threaded through the gateway and echoed back on events; use a
  UUID so order ids are not enumerable.
- The kit never logs secrets and takes all credentials via config (env).

## Adding a provider

Implement `PaymentProviderAdapter` (`createCheckout` / `handleWebhook` /
`reconcile`, see `src/types.ts`) and register it in `createPaymentsKit`.
Consumers don't change — they keep calling the same three methods and
receiving the same typed events.

## Compatibility & versioning

- Node ≥ 18.17 (global `fetch`). ESM. TypeScript types are first-class
  (source `src/`, build `dist/`).
- Semantic versioning: see [CHANGELOG.md](./CHANGELOG.md). Until 1.0,
  minor versions may adjust types — pin accordingly.

## License

Commercial — see [LICENSE.md](./LICENSE.md).
