'use client'
import { useState } from 'react'
import Link from 'next/link'
import { getPackage } from '@/lib/packages'

/**
 * Admin-only smoke-test page for the Mercado Pago payment pipeline.
 *
 * Triggers a $1 USD (1000 ARS) preference against the live MP account
 * configured by `MP_ACCESS_TOKEN`, then redirects to the public MP
 * checkout URL so a real card transaction can run end-to-end. Used to
 * validate:
 *   - preference creation server-side (admin-gated `tier_test` package)
 *   - MP checkout UX with our branding (statement_descriptor, back_urls)
 *   - webhook delivery + signature verification
 *   - DB row update in `mp_payments` (status, metadata, mp_payment_id)
 *   - email confirmation (admin + payer via Resend, see webhook handler)
 *   - return-trip redirect to /pagos?status=approved
 *
 * Access control: lives under /admin so the middleware admin-gate
 * (src/middleware.ts) protects it. The crear-preferencia API also
 * verifies admin role for `tier_test` to defense-in-depth against any
 * matcher gap in middleware.
 *
 * Cleanup: the test row in mp_payments stays for audit. The actual money
 * goes to the marketplace-es MP account (where MP_ACCESS_TOKEN points). Refund
 * via the MP dashboard if you want to recover the test ARS.
 */

const MP_REDIRECT_BASE = 'https://www.mercadopago.com.ar/checkout/v1/redirect'

// Smoke-test amounts come from the server-authoritative catalogue (the
// admin-gated tier_test SKU) — never hardcoded here.
const TEST_PKG = getPackage('tier_test')
const TEST_AMOUNT_LABEL = TEST_PKG
  ? `${TEST_PKG.price_usd} USD (${TEST_PKG.price_local} ARS)`
  : 'test'

export default function TestPaymentPage() {
  const [status, setStatus] = useState<'idle' | 'creating' | 'redirecting' | 'error'>('idle')
  const [error,  setError]  = useState<string | null>(null)
  const [payerEmail, setPayerEmail] = useState('')

  async function startTest() {
    setStatus('creating')
    setError(null)
    try {
      const res = await fetch('/api/pagos/mp/crear-preferencia', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          package_id:  'tier_test',
          payer_email: payerEmail.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json?.preference_id) {
        setStatus('error')
        setError(json?.error || `HTTP ${res.status}`)
        return
      }
      setStatus('redirecting')
      window.location.href = `${MP_REDIRECT_BASE}?pref_id=${encodeURIComponent(json.preference_id)}`
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <main className="min-h-screen bg-[var(--v-bg-base)] text-white">
      <div className="mx-auto max-w-[640px] px-6 py-16">
        <div className="mb-8 text-[11px] uppercase tracking-[0.22em] text-white/35">
          <Link href="/admin" className="hover:text-[var(--v-accent)] no-underline text-white/50">Admin</Link>
          <span className="mx-2 text-white/20">·</span>
          <span className="text-white/70">Test payment</span>
        </div>

        <h1 className="m-0 font-serif text-[clamp(28px,4vw,40px)] font-normal leading-[1.15] tracking-[0.005em] text-white/90">
          Mercado Pago — smoke test
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-white/55">
          Genera una preferencia de <span className="text-[var(--v-accent)]">{TEST_AMOUNT_LABEL}</span> y te redirige al checkout de MP para pagar con tu tarjeta real. Sirve para validar la pipeline completa: preferencia → checkout → webhook → DB → email.
        </p>

        <div className="mt-10 space-y-6 rounded-[2px] border border-[rgba(201,168,110,0.15)] bg-[rgba(201,168,110,0.03)] p-8">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.22em] text-white/55 mb-2">
              Payer email <span className="text-white/35">(opcional)</span>
            </label>
            <input
              type="email"
              value={payerEmail}
              onChange={(e) => setPayerEmail(e.target.value)}
              placeholder="email-para-recibo@ejemplo.com"
              className="w-full rounded-[2px] border border-[rgba(201,168,110,0.2)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-[14px] text-white/85 placeholder:text-white/25 focus:border-[var(--v-accent)] focus:outline-none"
              disabled={status !== 'idle'}
            />
            <p className="mt-2 text-[11px] text-white/35">
              Si lo dejás vacío, MP usa el email asociado a tu cuenta al pagar. El recibo lo envía Marketplace a este email + a <code className="text-[var(--v-accent)]">ADMIN_EMAIL</code> configurado.
            </p>
          </div>

          <button
            onClick={startTest}
            disabled={status === 'creating' || status === 'redirecting'}
            className="w-full rounded-[2px] bg-[var(--v-accent)] px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-[var(--v-bg-base)] transition-colors hover:bg-[var(--v-accent-light)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'idle'        && `Crear preferencia ${TEST_PKG ? `$${TEST_PKG.price_usd} USD` : ''} →`}
            {status === 'creating'    && 'Creando preferencia...'}
            {status === 'redirecting' && 'Redirigiendo a Mercado Pago...'}
            {status === 'error'       && 'Reintentar'}
          </button>

          {error && (
            <div className="rounded-[2px] border border-[rgba(224,85,85,0.25)] bg-[rgba(224,85,85,0.04)] px-4 py-3 text-[13px] text-[var(--v-error)]">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>

        <section className="mt-12 space-y-4 text-[13px] leading-relaxed text-white/60">
          <h2 className="font-serif text-[18px] text-white/85 mb-3">Qué inspeccionar después del pago</h2>
          <ol className="list-decimal space-y-2 pl-5">
            <li><strong className="text-white/85">Vercel logs</strong> — buscar <code className="text-[var(--v-accent)]">[MP webhook][tier_test]</code>. El handler dumpea el payload completo de MP + los headers de firma para esta SKU específicamente.</li>
            <li><strong className="text-white/85">MP dashboard</strong> — la operación aparece en tu cuenta Marketplace MP (la del <code className="text-[var(--v-accent)]">MP_ACCESS_TOKEN</code>) con $1 cobrado a tu tarjeta. Refundeable manualmente desde ahí.</li>
            <li><strong className="text-white/85">Email</strong> — Resend envía un recibo HTML al email del pagador + al <code className="text-[var(--v-accent)]">ADMIN_EMAIL</code> configurado. Revisar inbox de ambos.</li>
            <li><strong className="text-white/85">Supabase DB</strong> — table <code className="text-[var(--v-accent)]">mp_payments</code>, row con <code className="text-[var(--v-accent)]">package_id = &apos;tier_test&apos;</code>, status pasa de <code className="text-[var(--v-accent)]">pending → approved</code>. Metadata incluye payer_email, payment_method, status_detail.</li>
            <li><strong className="text-white/85">Return trip</strong> — al completar el pago MP redirige a <code className="text-[var(--v-accent)]">/pagos?status=approved</code> automáticamente.</li>
          </ol>
        </section>

        <p className="mt-10 text-[11px] text-white/35">
          Este endpoint es admin-only — la API rechaza el package <code>tier_test</code> con 403 si no estás autenticado como admin.
        </p>
      </div>
    </main>
  )
}
