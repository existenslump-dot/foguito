#!/usr/bin/env node
/**
 * Send a REAL signed NOWPayments IPN to the demo server — exercises the full
 * webhook path (HMAC-SHA512 over sorted-key JSON → handleWebhook → normalized
 * PaymentEvent) with no gateway account.
 *
 * Boot the server first with a provider + secret configured:
 *
 *   NOWPAYMENTS_API_KEY=demo NOWPAYMENTS_IPN_SECRET=demo-secret npm run demo
 *
 * then:
 *
 *   npm run demo:webhook                                  # 'finished' → payment.confirmed
 *   npm run demo:webhook -- --status waiting              # → payment.pending
 *   npm run demo:webhook -- --order my-order --amount 99  # custom order/amount
 *
 * Flags: --url --secret --order --status --amount --currency
 * The secret defaults to NOWPAYMENTS_IPN_SECRET or 'demo-secret' — it must
 * match what the server was booted with, exactly like production.
 */
import { createHmac } from 'node:crypto'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const url = arg('url', process.env.DEMO_WEBHOOK_URL || 'http://localhost:8787/webhooks/nowpayments')
const secret = arg('secret', process.env.NOWPAYMENTS_IPN_SECRET || 'demo-secret')
const status = arg('status', 'finished')
const orderId = arg('order', `demo-${Date.now()}`)
const amount = Number(arg('amount', '20'))
const currency = arg('currency', 'usd')

// Shape mirrors a real NOWPayments IPN payload (the fields the kit reads).
const payload = {
  payment_id: Math.floor(Math.random() * 1e9),
  payment_status: status,
  order_id: orderId,
  price_amount: amount,
  price_currency: currency,
  pay_currency: 'usdttrc20',
  actually_paid: status === 'finished' ? amount : 0,
}

// NOWPayments signs the JSON with alphabetically sorted keys (HMAC-SHA512).
const sorted = JSON.stringify(
  Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))),
)
const signature = createHmac('sha512', secret).update(sorted).digest('hex')

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-nowpayments-sig': signature,
  },
  // Send the SORTED serialization — the signature covers these exact bytes.
  body: sorted,
}).catch((err) => {
  console.error(`✗ could not reach ${url} — is the demo server running? (npm run demo)`)
  console.error(`  ${err.cause?.code || err.message}`)
  process.exit(1)
})

const body = await res.json().catch(() => ({}))
console.log(`→ POST ${url}`)
console.log(`  order_id=${orderId} payment_status=${status} price_amount=${amount} ${currency.toUpperCase()}`)
console.log(`← HTTP ${res.status}`, JSON.stringify(body))
if (res.status === 401) {
  console.log('  (401 = signature rejected — boot the server and this script with the SAME secret)')
}
