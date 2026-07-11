'use client'

/**
 * Per-record 2257 review panel (mirror of DiditDecisionPanel). Loads ON DEMAND
 * (toggle) — not on mount — so a queue of many rows doesn't fan out a request
 * each. Reads /api/admin/performers/[id] (service-role, requireAdmin): shows the
 * DECRYPTED legal name + a signed link to the ID document, and lets the admin
 * CERTIFY the record complete (POST .../complete, requires fresh admin TOTP).
 *
 * Certifying is one of the only two 2257 certification paths (the other is the
 * Didit webhook for the creator's own self record); until a record is complete,
 * content_publish_guard blocks publishing content linked to it.
 */

import { useState } from 'react'

const MONO = { fontFamily: 'var(--v-font-ui)' } as const

type PerformerReview = {
  id: string
  added_by: string | null
  legal_name: string
  doc_url: string | null
  custodian: string | null
  didit_session_id: string | null
  is_self: boolean
  is_complete: boolean
  dob_verified: boolean
  created_at: string
}

export default function AdminPerformerReview({
  performerId,
  onCompleted,
  notify,
}: {
  performerId: string
  onCompleted?: () => void
  notify?: (text: string, type: 'success' | 'error') => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [performer, setPerformer] = useState<PerformerReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [certifying, setCertifying] = useState(false)

  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (loaded) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/performers/${encodeURIComponent(performerId)}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'No se pudo cargar el registro 2257')
      setPerformer(data?.performer ?? null)
      setLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red')
    }
    setLoading(false)
  }

  async function certify() {
    setCertifying(true)
    try {
      const res = await fetch(`/api/admin/performers/${encodeURIComponent(performerId)}/complete`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify?.(data?.error || 'No se pudo certificar el registro 2257', 'error')
        setCertifying(false)
        return
      }
      setPerformer((p) => (p ? { ...p, is_complete: true, dob_verified: true } : p))
      notify?.('Registro 2257 certificado', 'success')
      onCompleted?.()
    } catch (err) {
      notify?.(err instanceof Error ? err.message : 'Error de red al certificar', 'error')
    }
    setCertifying(false)
  }

  return (
    <div className="mb-2">
      <button
        onClick={toggle}
        className="px-3.5 py-2 bg-white/5 border border-[var(--v-accent)]/20 rounded-lg cursor-pointer text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-accent)] hover:bg-[var(--v-accent)]/10 transition-colors"
        style={MONO}
      >
        {open ? 'Ocultar 2257' : 'Revisar 2257'}
      </button>

      {open && (
        <div className="mt-2 p-4 bg-[var(--v-bg-base)] border border-[var(--v-accent)]/15 rounded-lg">
          {loading && <p className="text-[10px] text-[var(--v-text-tertiary)]" style={MONO}>Cargando…</p>}
          {error && !loading && <p className="text-[10px] text-[var(--v-error)]" style={MONO}>{error}</p>}
          {!loading && !error && loaded && !performer && (
            <p className="text-[10px] text-[var(--v-text-tertiary)]" style={MONO}>Registro no encontrado.</p>
          )}
          {!loading && !error && performer && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px] text-[var(--v-text-primary)]" style={MONO}>
                <div><span className="text-[var(--v-text-tertiary)]">Nombre legal: </span>{performer.legal_name || '—'}</div>
                <div><span className="text-[var(--v-text-tertiary)]">Custodio: </span>{performer.custodian || '—'}</div>
                <div><span className="text-[var(--v-text-tertiary)]">Tipo: </span>{performer.is_self ? 'Creadora (self)' : 'Colaborador/a'}</div>
                <div><span className="text-[var(--v-text-tertiary)]">DOB verificada: </span>{performer.dob_verified ? 'Sí' : 'No'}</div>
              </div>

              {performer.doc_url && (
                <a
                  href={performer.doc_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-start px-3.5 py-2 bg-white/5 border border-white/5 rounded-lg text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors"
                  style={MONO}
                >
                  Ver Documento
                </a>
              )}

              {performer.is_complete ? (
                <span className="self-start text-[9px] font-normal tracking-[.18em] uppercase px-2.5 py-1 rounded-md border border-[rgba(106,176,106,0.3)] text-[var(--v-success)]" style={MONO}>
                  2257 Completo
                </span>
              ) : (
                <button
                  onClick={certify}
                  disabled={certifying}
                  className="self-start px-5 py-2.5 bg-[rgba(106,176,106,0.1)] border border-[rgba(106,176,106,0.3)] rounded-lg cursor-pointer text-[9px] font-normal tracking-[.22em] uppercase text-[var(--v-success)] hover:bg-[rgba(106,176,106,0.2)] transition-colors disabled:opacity-50"
                  style={MONO}
                >
                  {certifying ? 'Certificando…' : 'Certificar 2257'}
                </button>
              )}

              <p className="text-[8px] text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                Certificar exige verificar la edad (≥18) y la identidad del/la performer. Registro con retención legal (18 U.S.C. 2257).
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
