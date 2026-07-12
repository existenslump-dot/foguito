'use client'

/**
 * SubscribeButton — botón de suscripción a una creadora (PR-6).
 *
 * POSTea same-origin a /api/subscribe con { creatorId } (server-authoritative:
 * liga el fanId a la sesión, el precio lo pone la DB). En éxito refresca el
 * server component para que la RLS ya devuelva el contenido 'tier' desbloqueado.
 * Maneja el 402 (foguitos insuficientes) con un mensaje claro.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const MONO = {
  fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
} as const

export default function SubscribeButton({
  creatorId,
  priceLabel,
}: {
  creatorId: string
  priceLabel: string
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function onClick() {
    setMsg(null)
    setSaving(true)
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId }),
      })
      if (res.ok) {
        router.refresh()
        return
      }
      if (res.status === 401) {
        setMsg('Ingresá para suscribirte.')
      } else if (res.status === 402) {
        setMsg('Foguitos insuficientes.')
      } else if (res.status === 409) {
        setMsg('Esta creadora no ofrece suscripción.')
      } else {
        setMsg('No se pudo suscribir.')
      }
    } catch {
      setMsg('No se pudo suscribir.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={saving}
        style={{
          ...MONO,
          fontSize: '9px',
          fontWeight: 400,
          letterSpacing: '.2em',
          textTransform: 'uppercase',
          background: 'var(--v-accent)',
          color: 'var(--v-bg-base)',
          border: 'none',
          padding: '11px 24px',
          borderRadius: '2px',
          cursor: saving ? 'default' : 'pointer',
          opacity: saving ? 0.6 : 1,
          transition: 'opacity .3s ease',
        }}
      >
        {saving ? 'Suscribiendo…' : `Suscribirse · ${priceLabel}`}
      </button>
      {msg && (
        <p style={{ ...MONO, fontSize: '9px', color: 'var(--v-danger, #e05a5a)', marginTop: '8px' }}>
          {msg}
        </p>
      )}
    </div>
  )
}
