'use client'

/**
 * ContentUnlockButton — botón de desbloqueo de una pieza PPV (PR-6).
 *
 * POSTea same-origin a /api/content/[id]/unlock (server-authoritative: liga el
 * fanId a la sesión, el precio lo pone la DB). En éxito refresca el server
 * component para que la RLS ya devuelva la pieza desbloqueada. Maneja el 402
 * (foguitos insuficientes) con un mensaje claro.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const MONO = {
  fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
} as const

export default function ContentUnlockButton({
  contentId,
  priceLabel,
}: {
  contentId: string
  priceLabel: string
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function onClick() {
    setMsg(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/content/${contentId}/unlock`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        router.refresh()
        return
      }
      if (res.status === 401) {
        setMsg('Ingresá para desbloquear.')
      } else if (res.status === 402) {
        setMsg('Foguitos insuficientes.')
      } else {
        const data = await res.json().catch(() => ({}))
        setMsg(data?.error === 'not_purchasable' ? 'No disponible.' : 'No se pudo desbloquear.')
      }
    } catch {
      setMsg('No se pudo desbloquear.')
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
          fontSize: '8px',
          fontWeight: 400,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          background: 'var(--v-accent)',
          color: 'var(--v-bg-base)',
          border: 'none',
          padding: '9px 12px',
          borderRadius: '2px',
          cursor: saving ? 'default' : 'pointer',
          opacity: saving ? 0.6 : 1,
          transition: 'opacity .3s ease',
        }}
      >
        {saving ? 'Desbloqueando…' : `Desbloquear · ${priceLabel}`}
      </button>
      {msg && (
        <p style={{ ...MONO, fontSize: '8px', color: 'var(--v-danger, #e05a5a)', marginTop: '6px' }}>
          {msg}
        </p>
      )}
    </div>
  )
}
