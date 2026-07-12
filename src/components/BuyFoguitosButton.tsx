'use client'

/**
 * BuyFoguitosButton — botón de compra de un pack de foguitos (PR-7 money-in).
 *
 * POSTea same-origin a /api/foguitos/checkout (server-authoritative: liga el
 * userId a la sesión, el precio/monto salen del catálogo). En éxito:
 *   - si el provider devolvió una `payUrl` → redirige al checkout hosteado,
 *   - si devolvió una `payAddress` (crypto) → la muestra en pantalla.
 * El PAN NUNCA toca esta UI: sólo se muestra/redirige al target hosteado por el
 * procesador. Maneja 401 (sesión) y 404 (feature off) con mensajes claros.
 */

import { useState } from 'react'

const MONO = {
  fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
} as const

export default function BuyFoguitosButton({
  packId,
  label,
}: {
  packId: string
  label: string
}) {
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [payAddress, setPayAddress] = useState<string | null>(null)

  async function onClick() {
    setMsg(null)
    setPayAddress(null)
    setSaving(true)
    try {
      const res = await fetch('/api/foguitos/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      })
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          payUrl?: string | null
          payAddress?: string | null
        }
        if (data.payUrl) {
          // Redirige al checkout hosteado del procesador (PAN cero).
          window.location.href = data.payUrl
          return
        }
        if (data.payAddress) {
          setPayAddress(data.payAddress)
        } else {
          setMsg('Compra iniciada. Seguí las instrucciones de pago.')
        }
        return
      }
      if (res.status === 401) {
        setMsg('Ingresá para comprar foguitos.')
      } else if (res.status === 404) {
        setMsg('La compra de foguitos no está disponible por ahora.')
      } else if (res.status === 429) {
        setMsg('Demasiados intentos. Probá de nuevo en un minuto.')
      } else {
        setMsg('No se pudo iniciar la compra.')
      }
    } catch {
      setMsg('No se pudo iniciar la compra.')
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
          width: '100%',
          fontSize: '9px',
          fontWeight: 400,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          background: 'var(--v-accent)',
          color: 'var(--v-bg-base)',
          border: 'none',
          padding: '11px 12px',
          borderRadius: '2px',
          cursor: saving ? 'default' : 'pointer',
          opacity: saving ? 0.6 : 1,
          transition: 'opacity .3s ease',
        }}
      >
        {saving ? 'Iniciando…' : label}
      </button>
      {payAddress && (
        <p
          style={{
            ...MONO,
            fontSize: '9px',
            color: 'rgba(255,255,255,0.7)',
            marginTop: '8px',
            wordBreak: 'break-all',
          }}
        >
          Enviá el pago a: <code>{payAddress}</code>
        </p>
      )}
      {msg && (
        <p style={{ ...MONO, fontSize: '9px', color: 'var(--v-danger, #e05a5a)', marginTop: '6px' }}>
          {msg}
        </p>
      )}
    </div>
  )
}
