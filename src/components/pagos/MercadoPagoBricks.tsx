'use client'

import { useState, useEffect } from 'react'
import { initMercadoPago, CardPayment, StatusScreen } from '@mercadopago/sdk-react'

// Initialize MP SDK at module load (client-side only). MP's docs require this
// to happen before any Brick component renders — doing it lazily from a
// useEffect can race with the component mount.
const MP_PUBLIC_KEY = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY
let mpInitialized = false
if (typeof window !== 'undefined' && MP_PUBLIC_KEY) {
  try {
    initMercadoPago(MP_PUBLIC_KEY, { locale: 'es-AR' })
    mpInitialized = true
  } catch (e) {
    console.error('[MP] initMercadoPago failed', e)
  }
} else if (typeof window !== 'undefined') {
  console.warn('[MP] NEXT_PUBLIC_MP_PUBLIC_KEY is not set — CardPayment will not render')
}

interface Props {
  packageId: string
  credits: number
  amountUsd: number
  amountArs: number
  label: string
  /** Pass the access_token from the parent page to avoid creating a second
   *  Supabase client (which causes GoTrueClient lock errors in the browser). */
  accessToken: string | null
  /** Concierge mode: anonymous user — email is required for receipt delivery. */
  payerEmail?: string
  /** Self-serve renewal: post the paid activation should extend. */
  renewPostId?: string | null
}

/**
 * Track the site theme (`.dark` on <html>) so the Brick renders with the
 * matching MP theme. The previous hardcoded `theme: 'dark'` painted white
 * form text over the light-mode card background — unreadable.
 */
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    const el = document.documentElement
    const update = () => setIsDark(el.classList.contains('dark'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return isDark
}

/** Resolve a CSS custom property to its computed value — MP's customVariables
 *  need concrete colors; `var(...)` strings don't resolve inside the Brick. */
function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

export default function MercadoPagoBricks({
  packageId, credits, amountUsd, amountArs, label, accessToken, payerEmail, renewPostId,
}: Props) {
  const isDark = useIsDark()
  const [preferenceId, setPreferenceId] = useState<string | null>(null)
  const [internalId,   setInternalId]   = useState<string | null>(null)
  const [paymentId,    setPaymentId]    = useState<string | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)

  useEffect(() => {
    // Surface config errors immediately so they're obvious in the UI, not
    // buried in devtools ("Cargando…" forever). setState calls here are
    // legitimate external-state syncs (env var presence → UI); the React
    // Compiler can't tell them apart from cascade loops.
    if (!MP_PUBLIC_KEY) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('Mercado Pago no está configurado (falta NEXT_PUBLIC_MP_PUBLIC_KEY).')
      setLoading(false)
      return
    }
    if (!mpInitialized) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('No se pudo inicializar Mercado Pago.')
      setLoading(false)
      return
    }
    const init = async () => {
      setLoading(true); setError(null); setPaymentId(null)
      try {
        const res = await fetch('/api/pagos/mp/crear-preferencia', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            package_id: packageId,
            credits,
            amount_usd: amountUsd,
            amount_ars: amountArs,
            label,
            payer_email: payerEmail || null, // Concierge mode: anonymous payer
            ...(renewPostId ? { renew_post_id: renewPostId } : {}),
          }),
        })
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          console.error('[MP] preferencia failed', res.status, body)
          throw new Error(`preference_failed_${res.status}`)
        }
        const data = await res.json()
        setPreferenceId(data.preference_id)
        setInternalId(data.internal_id)
      } catch (e) {
        console.error('[MP] init error', e)
        setError('No se pudo iniciar el pago. Intentá de nuevo.')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [packageId, credits, amountUsd, amountArs, label, accessToken, payerEmail, renewPostId])

  const handleSubmit = async (formData: unknown): Promise<void> => {
    try {
      // Log what the Brick actually produced so we can diagnose MP 3031
      // ('security_code_id can't be null') if it comes back. The SDK's
      // formData shape changed across versions and doesn't always include
      // a fresh token.
      // Dev-only diagnostic so we can spot SDK shape changes before they
      // hit prod.
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[MP] Brick formData keys', Object.keys(formData as object))
      }
      const res = await fetch('/api/pagos/mp/procesar-pago', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ ...(formData as object), internal_id: internalId }),
      })
      const data = await res.json()
      if (!res.ok || !data.payment_id) {
        setError(data.error || 'Error al procesar el pago.')
        return
      }
      setPaymentId(data.payment_id)
    } catch {
      setError('Error al procesar el pago. Intentá de nuevo.')
    }
  }

  if (paymentId) {
    return (
      <div style={{ marginTop: '16px' }}>
        <StatusScreen
          initialization={{ paymentId }}
          onError={(err) => console.error('[MP StatusScreen]', err)}
        />
      </div>
    )
  }

  if (loading) {
    return (
      <p style={{
        textAlign: 'center', marginTop: '20px', padding: '16px',
        fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px',
        fontWeight: 400, letterSpacing: '.2em', textTransform: 'uppercase',
        color: 'rgba(37, 99, 235,0.6)', animation: 'mpPulse 1.5s ease-in-out infinite',
      }}>
        Cargando formulario de pago...
        <style>{`@keyframes mpPulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>
      </p>
    )
  }

  if (error) {
    return (
      <p style={{
        textAlign: 'center', marginTop: '16px', padding: '12px 14px',
        fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px',
        fontWeight: 400, letterSpacing: '.18em',
        color: 'var(--v-error)', background: 'rgba(224,85,85,0.05)',
        border: '1px solid rgba(224,85,85,0.15)', borderRadius: '2px',
      }}>
        {error}
      </p>
    )
  }

  if (!preferenceId) return null

  return (
    <div style={{ marginTop: '16px' }}>
      <CardPayment
        // `key` forces a full remount when the package / amount / payer email
        // changes. Without this the Brick can hold on to a stale tokenization
        // session and produce 'security_code_id can't be null' on submit.
        // Theme is initialization-only for the Brick, so remount on toggle too.
        key={`${packageId}-${internalId ?? 'x'}-${isDark ? 'dark' : 'light'}`}
        initialization={{
          amount: amountArs,
          // Passing payer.email scopes the tokenization to a fresh session.
          // When omitted, the Brick sometimes treats the card like a saved
          // card from a prior MP login and skips the CVV capture step
          // (→ MP error 3031, 'security_code_id can't be null').
          payer: payerEmail ? { email: payerEmail } : undefined,
        }}
        customization={{
          visual: {
            style: {
              theme: isDark ? 'dark' : 'default',
              customVariables: {
                baseColor: readToken('--brand-primary', '#2563EB'),
                borderRadiusFull: '2px',
                borderRadiusLarge: '2px',
                borderRadiusMedium: '2px',
                borderRadiusSmall: '2px',
                formBackgroundColor: readToken('--brand-surface', isDark ? '#1E293B' : '#F8FAFC'),
              },
            },
          },
          paymentMethods: {
            minInstallments: 1,
            maxInstallments: 1,
          },
        }}
        onSubmit={handleSubmit}
        onError={(err) => {
          console.error('[MP CardPayment]', err)
          setError('Error en el formulario de pago.')
        }}
      />
      <p style={{
        marginTop: '12px', textAlign: 'center',
        fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '8px',
        fontWeight: 400, letterSpacing: '.10em',
        color: 'var(--v-text-tertiary)', lineHeight: 1.6,
      }}>
        Formulario seguro de Mercado Pago · tus datos van directamente a MP · tu pago se acreditará al instante
      </p>
    </div>
  )
}
