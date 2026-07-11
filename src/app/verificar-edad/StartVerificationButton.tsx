'use client'

import { useState } from 'react'

/**
 * Client CTA that kicks off the real age-verification flow.
 *
 * It POSTs to `/api/age-verify/start` (server-authoritative — the jurisdiction
 * and the provider session are derived server-side, never trusted from here)
 * and navigates to the hosted URL the provider returns. There is deliberately
 * NO local "I am 18" checkbox or cookie — passing the gate requires a real
 * verification row written by the webhook.
 */
export function StartVerificationButton({ label }: { label: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/age-verify/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setError(data.error || 'No pudimos iniciar la verificación. Intentá de nuevo.')
        setLoading(false)
        return
      }
      // Navigate to the provider's hosted flow (or the dev stub URL).
      window.location.href = data.url
    } catch {
      setError('Error de red. Intentá de nuevo.')
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <button
        type="button"
        onClick={start}
        disabled={loading}
        style={{
          fontFamily: "'Montserrat', sans-serif",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: '#fff',
          background: 'var(--v-accent)',
          border: 'none',
          padding: '14px 32px',
          borderRadius: 2,
          cursor: loading ? 'wait' : 'pointer',
          opacity: loading ? 0.7 : 1,
          transition: 'opacity .2s ease',
        }}
      >
        {loading ? 'Iniciando…' : label}
      </button>
      {error && (
        <p
          role="alert"
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontSize: 12,
            color: '#c0392b',
            margin: 0,
          }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
