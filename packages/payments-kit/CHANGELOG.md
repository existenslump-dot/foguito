# Changelog

All notable changes to `@marketplace/payments-kit` are documented here.
This project follows [Semantic Versioning](https://semver.org). Until 1.0,
minor releases may include type-level breaking changes.

## [0.1.0] — 2026-06-10

Initial release.

### Added
- `createPaymentsKit(config)` → `{ createCheckout, handleWebhook, reconcile }`
  with typed, normalized `PaymentEvent`s and an `onPaymentEvent` hook.
- **MercadoPago** adapter: Checkout Pro (`redirect`), Bricks (`card_token`)
  and **PIX** (`pix`) checkout shapes; `x-signature` HMAC-SHA256 webhook
  verification (fail-closed); event amounts re-fetched from the Payments API.
- **NOWPayments** adapter: `crypto` checkout; `x-nowpayments-sig`
  HMAC-SHA512 (sorted-key JSON) IPN verification (fail-closed); full status
  mapping (`waiting`/`confirming`/`finished`/`partially_paid`/`failed`/`expired`).
- `reconcile(provider, gatewayTxId)` — fresh gateway truth for sweeps/disputes.
- Standalone demo (`npm run demo`) + signed-IPN sender (`npm run demo:webhook`).
