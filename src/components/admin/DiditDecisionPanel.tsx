'use client'

/**
 * Panel with a user's Didit decision, inside each AdminVerifications row. Loads
 * ON DEMAND (toggle) — not on mount — so it doesn't fire a request per row nor
 * interfere with the parent component's tests.
 *
 * Reads from /api/admin/verification-session (service-role, requireAdmin): the
 * verification_sessions table is RLS deny-all. Shows status, scores, reason and
 * the data extracted from the document (decrypted server-side). The manual
 * approve/reject override still lives in AdminVerifications.
 */

import { useState } from 'react'

const MONO = { fontFamily: 'var(--v-font-ui)' } as const

type DiditSession = {
  didit_session_id: string | null
  status: string
  decision: string | null
  decline_reason: string | null
  face_match_score: number | null
  liveness_score: number | null
  last_webhook_at: string | null
  created_at: string
  id_verification: {
    first_name?: string | null
    last_name?: string | null
    document_number?: string | null
    date_of_birth?: string | null
    issuing_country?: string | null
    document_type?: string | null
  } | null
}

const STATUS_LABEL: Record<string, string> = {
  created: 'Iniciada',
  in_progress: 'En progreso',
  in_review: 'En revisión',
  approved: 'Aprobada',
  declined: 'Rechazada',
  abandoned: 'Abandonada',
  expired: 'Expirada',
}

function statusColor(status: string): string {
  if (status === 'approved') return 'var(--v-success)'
  if (status === 'declined') return 'var(--v-error)'
  if (status === 'in_review') return 'var(--v-accent)'
  return 'var(--v-text-tertiary)'
}

function Score({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null
  const low = value < 50
  return (
    <span
      className="text-[9px] font-normal tracking-[.1em] px-2 py-1 rounded-md border"
      style={{
        ...MONO,
        color: low ? 'var(--v-error)' : 'var(--v-success)',
        borderColor: low ? 'rgba(224,85,85,0.3)' : 'rgba(106,176,106,0.3)',
      }}
    >
      {label} {Math.round(value)}%
    </span>
  )
}

export default function DiditDecisionPanel({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [session, setSession] = useState<DiditSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (loaded) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/verification-session?userId=${encodeURIComponent(userId)}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'No se pudo cargar la verificación')
      setSession(data?.session ?? null)
      setLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red')
    }
    setLoading(false)
  }

  return (
    <div className="mb-4">
      <button
        onClick={toggle}
        className="px-3.5 py-2 bg-white/5 border border-[var(--v-accent)]/20 rounded-lg cursor-pointer text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-accent)] hover:bg-[var(--v-accent)]/10 transition-colors"
        style={MONO}
      >
        {open ? 'Ocultar Didit' : 'Datos Didit'}
      </button>

      {open && (
        <div className="mt-2 p-4 bg-[var(--v-bg-base)] border border-[var(--v-accent)]/15 rounded-lg">
          {loading && (
            <p className="text-[10px] text-[var(--v-text-tertiary)]" style={MONO}>Cargando…</p>
          )}
          {error && !loading && (
            <p className="text-[10px] text-[var(--v-error)]" style={MONO}>{error}</p>
          )}
          {!loading && !error && loaded && !session && (
            <p className="text-[10px] text-[var(--v-text-tertiary)]" style={MONO}>
              Sin sesión de Didit · verificación manual.
            </p>
          )}
          {!loading && !error && session && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-[9px] font-normal tracking-[.18em] uppercase px-2.5 py-1 rounded-md border"
                  style={{ ...MONO, color: statusColor(session.status), borderColor: 'currentColor' }}
                >
                  Didit: {STATUS_LABEL[session.status] ?? session.status}
                </span>
                <Score label="Rostro" value={session.face_match_score} />
                <Score label="Prueba de vida" value={session.liveness_score} />
              </div>

              {session.decline_reason && (
                <p className="text-[10px] text-[var(--v-error)]" style={MONO}>
                  Motivo: {session.decline_reason}
                </p>
              )}

              {session.id_verification && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px] text-[var(--v-text-primary)]" style={MONO}>
                  {session.id_verification.first_name && (
                    <div><span className="text-[var(--v-text-tertiary)]">Nombre: </span>{session.id_verification.first_name} {session.id_verification.last_name ?? ''}</div>
                  )}
                  {session.id_verification.document_number && (
                    <div><span className="text-[var(--v-text-tertiary)]">Documento: </span>{session.id_verification.document_number}</div>
                  )}
                  {session.id_verification.date_of_birth && (
                    <div><span className="text-[var(--v-text-tertiary)]">Nacimiento: </span>{session.id_verification.date_of_birth}</div>
                  )}
                  {session.id_verification.issuing_country && (
                    <div><span className="text-[var(--v-text-tertiary)]">País: </span>{session.id_verification.issuing_country}</div>
                  )}
                </div>
              )}

              <p className="text-[8px] text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                Las imágenes del documento las custodia Didit. La decisión y el override final son tuyos.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
