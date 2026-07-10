'use client'
import { useState } from 'react'

interface Props {
  postId: string
  onClose: () => void
  /** Optional preset. When the caller opens the modal from a dedicated CTA,
   *  the category comes pre-selected to reduce friction. */
  presetCategory?: string
}

const REPORT_CATEGORIES = [
  { value: 'spam',                  label: 'Spam o publicación duplicada' },
  { value: 'estafa',                label: 'Estafa o fraude' },
  { value: 'contenido_inapropiado', label: 'Contenido inapropiado' },
  { value: 'contenido_prohibido',   label: 'Contenido prohibido o ilegal' },
  { value: 'otro',                  label: 'Otro' },
]

export default function ReportModal({ postId, onClose, presetCategory }: Props) {
  const [category, setCategory] = useState<string>(presetCategory ?? '')
  const [description, setDescription] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  // Surface server-side 429s and network errors. Before this, a rate-limited
  // or failed submit silently reset the button and left the user clicking
  // forever with no feedback.
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!category || sending) return
    const LS_KEY = `report_${postId}`
    const last = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
    if (last && Date.now() - Number(last) < 24 * 60 * 60 * 1000) {
      setDone(true)
      return
    }
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, category, description }),
      })
      if (res.ok) {
        localStorage.setItem(LS_KEY, String(Date.now()))
        setDone(true)
      } else if (res.status === 429) {
        setError('Demasiados reportes. Probá más tarde.')
      } else {
        setError('No se pudo enviar. Intentá de nuevo.')
      }
    } catch {
      setError('Error de conexión. Intentá de nuevo.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--v-bg-card)', border: '1px solid rgba(37, 99, 235,0.2)', borderRadius: '2px', padding: '28px', maxWidth: '360px', width: '100%' }}
      >
        {done ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <p style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '11px', fontWeight: 400, color: 'var(--v-success)', letterSpacing: '.12em' }}>
              Reporte enviado. Gracias.
            </p>
            <button onClick={onClose} style={{ marginTop: '20px', background: 'none', border: '1px solid rgba(37, 99, 235,0.12)', color: 'var(--v-text-tertiary)', padding: '10px 24px', borderRadius: '2px', cursor: 'pointer', fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px', letterSpacing: '.18em', textTransform: 'uppercase' }}>
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <h3 style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '20px', fontWeight:400, color: 'var(--v-text-primary)', marginBottom: '20px' , fontVariantNumeric: 'tabular-nums' }}>
              Reportar publicación
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              {REPORT_CATEGORIES.map(opt => (
                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="radio" name="report-cat" value={opt.value}
                    checked={category === opt.value}
                    onChange={() => setCategory(opt.value)}
                    style={{ accentColor: 'var(--v-accent)', width: '14px', height: '14px', flexShrink: 0 }}
                  />
                  <span style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '11px', fontWeight: 400, color: category === opt.value ? 'var(--v-text-primary)' : 'var(--v-text-tertiary)', letterSpacing: '.06em' }}>
                    {opt.label}
                  </span>
                </label>
              ))}
            </div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={300}
              rows={3}
              placeholder="Descripción adicional (opcional)"
              style={{ width: '100%', background: 'var(--v-bg-elevated)', border: '1px solid rgba(37, 99, 235,0.12)', borderRadius: '2px', padding: '10px 12px', color: 'var(--v-text-primary)', fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '11px', fontWeight: 400, resize: 'none', outline: 'none', marginBottom: '16px', boxSizing: 'border-box' }}
            />
            {error && (
              <p style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '10px', fontWeight: 400, color: '#d97b7b', letterSpacing: '.06em', marginBottom: '12px', lineHeight: 1.4 }}>
                {error}
              </p>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={submit}
                disabled={!category || sending}
                style={{ flex: 1, background: category ? 'var(--v-accent)' : 'var(--v-bg-elevated)', color: category ? '#FFFFFF' : 'var(--v-text-tertiary)', padding: '13px', borderRadius: '2px', border: 'none', cursor: category ? 'pointer' : 'not-allowed', fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px', fontWeight: 400, letterSpacing: '.2em', textTransform: 'uppercase', transition: 'background .3s' }}
              >
                {sending ? '…' : 'Enviar reporte'}
              </button>
              <button
                onClick={onClose}
                style={{ padding: '13px 20px', background: 'transparent', color: 'var(--v-text-tertiary)', border: '1px solid rgba(37, 99, 235,0.12)', borderRadius: '2px', cursor: 'pointer', fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px', fontWeight: 400, letterSpacing: '.18em', textTransform: 'uppercase' }}
              >
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
