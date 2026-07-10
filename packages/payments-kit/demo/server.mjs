/**
 * @marketplace/payments-kit — standalone checkout + webhook demo.
 *
 * Zero app dependencies: a bare node http server (no express) that exercises
 * ONLY the kit's public surface — createCheckout for the three checkout
 * shapes (MP Checkout Pro redirect, MP PIX, NOWPayments crypto) and
 * handleWebhook for the two providers.
 *
 * Run (Node 22.6+ — the kit is imported straight from its TS source):
 *   npm run demo           # boots this server on http://localhost:8787
 *
 * Config comes from the environment. With NO env set the server still boots
 * and serves the page — it just reports which providers are disabled, so you
 * can see the UI without any gateway account. createCheckout for a disabled
 * provider returns a friendly error instead of crashing.
 *
 *   MP_ACCESS_TOKEN        MercadoPago access token (enables MP checkout)
 *   MP_WEBHOOK_SECRET      MercadoPago x-signature HMAC secret
 *   NOWPAYMENTS_API_KEY    NOWPayments API key (enables crypto checkout)
 *   NOWPAYMENTS_IPN_SECRET NOWPayments IPN HMAC-SHA512 secret
 *   DEMO_BASE_URL          public base URL for gateway callbacks
 *                          (default http://localhost:8787)
 *   PORT                   listen port (default 8787)
 */
import { createServer } from 'node:http'
import { createPaymentsKit } from '../src/index.ts'

const PORT = Number(process.env.PORT || 8787)
const BASE_URL = process.env.DEMO_BASE_URL || `http://localhost:${PORT}`

// ── Provider config: only register a provider when its secret/token is
//    present. This is the "guard provider config presence" bit — the demo
//    boots with no env at all. ────────────────────────────────────────────
const hasMercadoPago = Boolean(process.env.MP_ACCESS_TOKEN)
const hasNowPayments = Boolean(process.env.NOWPAYMENTS_API_KEY)

const kit = createPaymentsKit({
  providers: {
    ...(hasMercadoPago
      ? {
          mercadopago: {
            accessToken: process.env.MP_ACCESS_TOKEN,
            webhookSecret: process.env.MP_WEBHOOK_SECRET,
            notificationUrl: `${BASE_URL}/webhooks/mercadopago`,
            backUrls: {
              success: `${BASE_URL}/?status=approved`,
              failure: `${BASE_URL}/?status=rejected`,
              pending: `${BASE_URL}/?status=pending`,
            },
            statementDescriptor: 'PAYMENTS KIT DEMO',
          },
        }
      : {}),
    ...(hasNowPayments
      ? {
          nowpayments: {
            apiKey: process.env.NOWPAYMENTS_API_KEY,
            ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET,
            ipnCallbackUrl: `${BASE_URL}/webhooks/nowpayments`,
            successUrl: `${BASE_URL}/?status=success`,
            cancelUrl: `${BASE_URL}/?status=cancel`,
          },
        }
      : {}),
  },
  // Demo only: lets the webhook routes accept an unsigned MP ping when no
  // secret is configured. Production is fail-closed (see README security model).
  allowUnsignedWebhooks: true,
  onPaymentEvent: (event) => {
    // Single place the kit hands every normalized event. The activation
    // recipe (idempotency + fulfilment) would live here in a real consumer.
    if (event.type === 'payment.confirmed') {
      console.log('\n>>> payment.confirmed  (safe to fulfil after YOUR idempotency check)')
    }
    console.log('    onPaymentEvent:', summarizeEvent(event))
  },
})

function summarizeEvent(event) {
  return {
    type: event.type,
    provider: event.provider,
    gatewayTxId: event.gatewayTxId,
    orderRef: event.orderRef,
    amount: event.amount,
    providerStatus: event.providerStatus,
  }
}

// ── Tiny helpers ────────────────────────────────────────────────────────
function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
  res.end(body)
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1_000_000) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function parseForm(raw) {
  const out = {}
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v
  return out
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
}

const STYLE = `
  body{font-family:system-ui,sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:40px;line-height:1.5}
  h1{color:#2563EB;font-weight:600;letter-spacing:.04em}
  h2{color:#2563EB;font-size:1rem;text-transform:uppercase;letter-spacing:.1em;margin-top:32px}
  a{color:#2563EB}
  form{background:#111;border:1px solid #2a2a2a;border-radius:8px;padding:20px;margin:14px 0;max-width:560px}
  button{background:#2563EB;color:#FFFFFF;border:0;border-radius:6px;padding:10px 18px;font-weight:600;cursor:pointer}
  .off{opacity:.45}
  .badge{display:inline-block;font-size:.7rem;padding:2px 8px;border-radius:99px;margin-left:8px;vertical-align:middle}
  .on-badge{background:#1d3b1d;color:#8fd98f}
  .off-badge{background:#3b1d1d;color:#d98f8f}
  code,pre{background:#000;border:1px solid #222;border-radius:6px;padding:2px 6px;color:#cdbf93}
  pre{padding:14px;overflow:auto}
  img{background:#fff;padding:8px;border-radius:6px;max-width:240px}
  .muted{color:#8a8270;font-size:.85rem}
`

function providerBadge(enabled) {
  return enabled
    ? '<span class="badge on-badge">enabled</span>'
    : '<span class="badge off-badge">disabled — no env</span>'
}

function page(inner) {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>payments-kit demo</title><style>${STYLE}</style></head>
<body><h1>@marketplace/payments-kit — checkout demo</h1>
<p class="muted">Base URL <code>${esc(BASE_URL)}</code> · MercadoPago ${providerBadge(hasMercadoPago)} · NOWPayments ${providerBadge(hasNowPayments)}</p>
${inner}
</body></html>`
}

function homePage() {
  const orderRef = `demo-${Date.now()}`
  return page(`
<h2>1 · MercadoPago — Checkout Pro (redirect)</h2>
<form method="POST" action="/checkout" class="${hasMercadoPago ? '' : 'off'}">
  <input type="hidden" name="provider" value="mercadopago">
  <input type="hidden" name="method" value="redirect">
  <input type="hidden" name="orderRef" value="${orderRef}-mp">
  <input type="hidden" name="currency" value="ARS">
  <input type="hidden" name="value" value="2500">
  <input type="hidden" name="description" value="Demo order (Checkout Pro)">
  <button type="submit">Create Checkout Pro preference</button>
  <p class="muted">ARS 2500 → hosted redirect (init_point).</p>
</form>

<h2>2 · MercadoPago — PIX (Brazil)</h2>
<form method="POST" action="/checkout" class="${hasMercadoPago ? '' : 'off'}">
  <input type="hidden" name="provider" value="mercadopago">
  <input type="hidden" name="method" value="pix">
  <input type="hidden" name="orderRef" value="${orderRef}-pix">
  <input type="hidden" name="currency" value="BRL">
  <input type="hidden" name="value" value="49.90">
  <input type="hidden" name="description" value="Demo order (PIX)">
  <label class="muted">Payer email (required for PIX):<br>
    <input type="email" name="payerEmail" value="buyer@example.com" style="width:280px"></label><br><br>
  <button type="submit">Create PIX payment</button>
  <p class="muted">Requires an MLB (Brazil) MercadoPago account and BRL amounts.</p>
</form>

<h2>3 · NOWPayments — crypto</h2>
<form method="POST" action="/checkout" class="${hasNowPayments ? '' : 'off'}">
  <input type="hidden" name="provider" value="nowpayments">
  <input type="hidden" name="method" value="crypto">
  <input type="hidden" name="orderRef" value="${orderRef}-np">
  <input type="hidden" name="currency" value="USD">
  <input type="hidden" name="value" value="20">
  <input type="hidden" name="description" value="Demo order (crypto)">
  <label class="muted">Pay currency:
    <input type="text" name="payCurrency" value="usdttrc20" style="width:120px"></label><br><br>
  <button type="submit">Create crypto payment</button>
  <p class="muted">USD 20 → on-chain pay address + amount.</p>
</form>

<h2>Webhooks</h2>
<p class="muted">POST a real signed IPN end-to-end with no gateway account:</p>
<pre>npm run demo:webhook            # default 'finished' (→ payment.confirmed)
npm run demo:webhook -- --order myorder --status waiting</pre>
`)
}

function resultPage(session) {
  let detail = ''
  if (session.redirectUrl) {
    detail = `<p><b>Redirect URL (Checkout Pro):</b></p>
      <p><a href="${esc(session.redirectUrl)}">${esc(session.redirectUrl)}</a></p>`
  } else if (session.qr) {
    detail = `<p><b>PIX QR (base64 PNG):</b></p>
      ${session.qr.base64 ? `<img alt="PIX QR" src="data:image/png;base64,${esc(session.qr.base64)}">` : '<p class="muted">(no QR image returned)</p>'}
      <p><b>copia-e-cola:</b></p><pre>${esc(session.qr.code)}</pre>
      ${session.qr.ticketUrl ? `<p><a href="${esc(session.qr.ticketUrl)}">ticket URL</a></p>` : ''}`
  } else if (session.payAddress) {
    detail = `<p><b>Pay address:</b> <code>${esc(session.payAddress)}</code></p>
      <p><b>Amount:</b> <code>${esc(session.payAmount)} ${esc(session.payCurrency)}</code></p>
      ${session.expiresAt ? `<p class="muted">Expires: ${esc(session.expiresAt)}</p>` : ''}`
  }
  return page(`
<h2>Checkout created</h2>
<p><b>Provider:</b> ${esc(session.provider)} · <b>Method:</b> ${esc(session.method)}</p>
<p><b>Gateway id:</b> <code>${esc(session.gatewayId)}</code> · <b>orderRef:</b> <code>${esc(session.orderRef)}</code></p>
${detail}
<p><a href="/">&larr; back</a></p>
`)
}

function errorPage(message) {
  return page(`<h2>Checkout error</h2><pre>${esc(message)}</pre><p><a href="/">&larr; back</a></p>`)
}

// ── Routing ───────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL)

    if (req.method === 'GET' && url.pathname === '/') {
      return html(res, 200, homePage())
    }

    if (req.method === 'POST' && url.pathname === '/checkout') {
      const form = parseForm(await readBody(req))
      if (!kit.providers[form.provider]) {
        return html(
          res,
          400,
          errorPage(
            `Provider '${form.provider}' is not configured. Set its env var ` +
              `(${form.provider === 'mercadopago' ? 'MP_ACCESS_TOKEN' : 'NOWPAYMENTS_API_KEY'}) and restart.`,
          ),
        )
      }
      try {
        const session = await kit.createCheckout({
          provider: form.provider,
          method: form.method,
          orderRef: form.orderRef,
          amount: { currency: form.currency, value: Number(form.value) },
          description: form.description,
          ...(form.payerEmail ? { payerEmail: form.payerEmail } : {}),
          ...(form.payCurrency ? { payCurrency: form.payCurrency } : {}),
        })
        console.log('[checkout]', form.provider, form.method, '→ gatewayId', session.gatewayId)
        return html(res, 200, resultPage(session))
      } catch (err) {
        console.error('[checkout] error:', err)
        return html(res, 502, errorPage(err?.message || String(err)))
      }
    }

    if (
      req.method === 'POST' &&
      (url.pathname === '/webhooks/mercadopago' || url.pathname === '/webhooks/nowpayments')
    ) {
      const provider = url.pathname.endsWith('mercadopago') ? 'mercadopago' : 'nowpayments'
      if (!kit.providers[provider]) {
        return json(res, 503, { error: `provider '${provider}' not configured` })
      }
      const rawBody = await readBody(req)
      const result = await kit.handleWebhook(provider, {
        rawBody,
        headers: (name) => req.headers[name.toLowerCase()] ?? null,
      })

      console.log(`\n[webhook:${provider}] ok=${result.ok} status=${result.status}`)
      if (result.ok && result.event) {
        if (result.event.type === 'payment.confirmed') {
          console.log('  >>> payment.confirmed <<<')
        }
        console.log('  event:', JSON.stringify(summarizeEvent(result.event), null, 2))
      } else if (!result.ok) {
        console.log('  rejected:', result.error)
      } else {
        console.log('  acked (no event):', JSON.stringify(result.body))
      }
      return json(res, result.status, result.body)
    }

    return html(res, 404, page('<h2>404</h2><p><a href="/">&larr; home</a></p>'))
  } catch (err) {
    console.error('[demo] handler error:', err)
    return json(res, 500, { error: err?.message || 'internal error' })
  }
})

server.listen(PORT, () => {
  console.log(`\npayments-kit demo → ${BASE_URL}`)
  console.log(`  MercadoPago: ${hasMercadoPago ? 'enabled' : 'DISABLED (set MP_ACCESS_TOKEN)'}`)
  console.log(`  NOWPayments: ${hasNowPayments ? 'enabled' : 'DISABLED (set NOWPAYMENTS_API_KEY)'}`)
  if (!hasMercadoPago && !hasNowPayments) {
    console.log('  (no providers configured — page still serves; checkout will report disabled)')
  }
  console.log(`\n  Try the offline event flow:  npm run demo:webhook`)
})
