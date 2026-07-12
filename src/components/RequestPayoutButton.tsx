'use client'

/**
 * RequestPayoutButton — pedir un payout de earnings (PR-8 money-out).
 *
 * POSTea same-origin a /api/payouts/request (server-authoritative: liga el
 * creatorId a la sesión, la elegibilidad + la reserva las hace la DB). El monto es
 * una intención; la RPC re-chequea earnings/elegibilidad. Muestra un estimado en
 * USDT con el rate de DISPLAY (placeholder) — el monto real lo fija la DB.
 *
 * Maneja 402 (earnings insuficientes), 403 (falta payout-KYC/sanciones), 409 (ya
 * hay un payout en curso), 400 (monto inválido), 401 (sesión) con mensajes claros.
 */

import { useState } from 'react'

const MONO = {
  fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
} as const

export default function RequestPayoutButton({
  balance,
  foguitosPerUsd,
  eligible,
}: {
  balance: number
  foguitosPerUsd: number
  eligible: boolean
}) {
  const [amount, setAmount] = useState<string>(balance > 0 ? String(balance) : '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const parsed = Number(amount)
  const validAmount = Number.isInteger(parsed) && parsed > 0 && parsed <= balance
  const estUsd = validAmount && foguitosPerUsd > 0 ? parsed / foguitosPerUsd : 0

  async function onClick() {
    setMsg(null)
    setDone(false)
    if (!validAmount) {
      setMsg('Ingresá un monto válido (entero, dentro de tu saldo).')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/payouts/request', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountFoguitos: parsed }),
      })
      if (res.ok) {
        setDone(true)
        setMsg('Solicitud de pago enviada. Te avisaremos cuando se procese.')
        return
      }
      if (res.status === 401) {
        setMsg('Ingresá para solicitar un pago.')
      } else if (res.status === 402) {
        setMsg('No tenés earnings suficientes para ese monto.')
      } else if (res.status === 403) {
        setMsg('Todavía no sos elegible: falta completar la verificación de pago.')
      } else if (res.status === 409) {
        setMsg('Ya tenés un pago en curso. Esperá a que se procese.')
      } else if (res.status === 429) {
        setMsg('Demasiados intentos. Probá de nuevo en un minuto.')
      } else if (res.status === 404) {
        setMsg('Los pagos no están disponibles por ahora.')
      } else {
        setMsg('No se pudo enviar la solicitud.')
      }
    } catch {
      setMsg('No se pudo enviar la solicitud.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <label style={{ ...MONO, fontSize: '9px', letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>
        Monto a retirar (foguitos)
      </label>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={balance}
        step={1}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={saving || done || !eligible || balance <= 0}
        placeholder="0"
        style={{
          ...MONO,
          fontSize: '14px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(37, 99, 235, 0.25)',
          borderRadius: '2px',
          padding: '11px 12px',
          color: '#FFFFFF',
          width: '100%',
        }}
      />
      {validAmount && (
        <p style={{ ...MONO, fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>
          ≈ US$ {estUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} (estimado)
        </p>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={saving || done || !eligible || !validAmount}
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
          padding: '12px',
          borderRadius: '2px',
          cursor: saving || done || !eligible || !validAmount ? 'default' : 'pointer',
          opacity: saving || done || !eligible || !validAmount ? 0.5 : 1,
          transition: 'opacity .3s ease',
        }}
      >
        {saving ? 'Enviando…' : done ? 'Solicitud enviada' : 'Solicitar pago'}
      </button>
      {msg && (
        <p
          style={{
            ...MONO,
            fontSize: '10px',
            color: done ? 'rgba(255,255,255,0.7)' : 'var(--v-danger, #e05a5a)',
            marginTop: '2px',
          }}
        >
          {msg}
        </p>
      )}
    </div>
  )
}
