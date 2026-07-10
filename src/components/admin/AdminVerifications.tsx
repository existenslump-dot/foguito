'use client'

/**
 * Currently hidden from the main /admin dashboard via {false && …} at the
 * callsite — the queue still mounts via parent-level fetch so a future
 * standalone /admin/verifications route can reuse this component.
 */

import { useState } from 'react'
import { recordAuditClient } from '@/lib/audit-client'
import DiditDecisionPanel from './DiditDecisionPanel'

import type { AdminVerification } from '@/lib/types/admin'

interface Props {
  verifications: AdminVerification[]
  /**
   * Parent handler that refetches the verifications list after a mutation.
   * We call this instead of mutating a prop-sourced list because the queue
   * depends on the `verification_status = pending` filter, which changes
   * after both approve + reject.
   */
  onRefetch: () => void
  openDocument: (url: string) => void
  notify: (text: string, type: 'success' | 'error') => void
}

const MONO = { fontFamily: "'Montserrat',sans-serif" } as const

export default function AdminVerifications({
  verifications, onRefetch, openDocument, notify,
}: Props) {
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  async function approve(profileId: string) {
    try {
      const res = await fetch('/api/admin/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, action: 'approve' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { notify(data?.error || 'No se pudo aprobar la verificación', 'error'); return }
      void recordAuditClient({
        eventType: 'kyc_approved',
        subjectType: 'profile',
        subjectId: profileId,
        metadata: { target_user_id: profileId },
      })
      notify('Verificación aprobada', 'success')
      onRefetch()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Error de red al aprobar', 'error')
    }
  }

  async function reject(profileId: string) {
    if (!rejectReason.trim()) {
      notify('Escribe un motivo de rechazo', 'error')
      return
    }
    try {
      const res = await fetch('/api/admin/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, action: 'reject', reason: rejectReason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { notify(data?.error || 'No se pudo rechazar la verificación', 'error'); return }
      void recordAuditClient({
        eventType: 'kyc_rejected',
        subjectType: 'profile',
        subjectId: profileId,
        metadata: { target_user_id: profileId, reason: rejectReason },
      })
      notify('Verificación rechazada', 'success')
      setRejectId(null)
      setRejectReason('')
      onRefetch()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Error de red al rechazar', 'error')
    }
  }

  return (
    <div className="mt-16 pt-12 border-t border-white/5">
      <h2 className="text-[clamp(20px,3vw,28px)] font-normal text-[var(--v-accent)] mb-6">
        Verificaciones Pendientes
        {verifications.length > 0 && (
          <span
            className="ml-3 text-sm text-[var(--v-accent)] bg-[var(--v-accent)]/10 px-2.5 py-1 rounded-[6px] font-normal"
            style={MONO}
          >
            {verifications.length}
          </span>
        )}
      </h2>

      {verifications.length === 0 ? (
        <p className="text-[11px] font-normal text-[var(--v-text-tertiary)]" style={MONO}>
          No hay verificaciones pendientes.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {verifications.map(v => (
            <div
              key={v.id}
              className="bg-[var(--v-bg-card)] border border-white/5 rounded-[6px] p-5"
            >
              <div className="flex justify-between items-start flex-wrap gap-3 mb-4">
                <div>
                  <p className="text-lg font-normal text-[var(--v-text-primary)]">
                    {v.full_name || 'Sin nombre'}
                  </p>
                  <p className="text-[9px] font-normal text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                    {v.email}
                  </p>
                </div>
                <span
                  className="text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-accent)] border border-[var(--v-accent)]/20 px-2.5 py-1 rounded-[6px]"
                  style={MONO}
                >
                  Pendiente
                </span>
              </div>

              <DiditDecisionPanel userId={v.id} />

              <div className="flex gap-2 flex-wrap mb-4">
                {v.identity_doc_url && (
                  <button
                    onClick={() => openDocument(v.identity_doc_url!)}
                    className="px-3.5 py-2 bg-white/5 border border-white/5 rounded-[6px] cursor-pointer text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors"
                    style={MONO}
                  >
                    Ver Documento
                  </button>
                )}
                {v.identity_selfie_url && (
                  <button
                    onClick={() => openDocument(v.identity_selfie_url!)}
                    className="px-3.5 py-2 bg-white/5 border border-white/5 rounded-[6px] cursor-pointer text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors"
                    style={MONO}
                  >
                    Ver Selfie
                  </button>
                )}
                {v.identity_video_url && (
                  <button
                    onClick={() => openDocument(v.identity_video_url!)}
                    className="px-3.5 py-2 bg-white/5 border border-white/5 rounded-[6px] cursor-pointer text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors"
                    style={MONO}
                  >
                    Ver Video
                  </button>
                )}
              </div>

              {rejectId === v.id ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="Motivo del rechazo..."
                    className="w-full bg-[var(--v-bg-base)] border border-[var(--v-error)]/20 p-3 rounded-[6px] outline-none text-[11px] font-normal text-[var(--v-text-primary)] min-h-[60px] resize-y box-border"
                    style={MONO}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => reject(v.id)}
                      className="flex-1 p-2.5 bg-[rgba(224,85,85,0.1)] border border-[rgba(224,85,85,0.3)] rounded-[6px] cursor-pointer text-[9px] font-normal tracking-[.22em] uppercase text-[var(--v-error)]"
                      style={MONO}
                    >
                      Confirmar Rechazo
                    </button>
                    <button
                      onClick={() => { setRejectId(null); setRejectReason('') }}
                      className="flex-1 p-2.5 bg-transparent border border-white/5 rounded-[6px] cursor-pointer text-[9px] font-normal tracking-[.22em] uppercase text-[var(--v-text-tertiary)]"
                      style={MONO}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => approve(v.id)}
                    className="px-5 py-2.5 bg-[rgba(106,176,106,0.1)] border border-[rgba(106,176,106,0.3)] rounded-[6px] cursor-pointer text-[9px] font-normal tracking-[.22em] uppercase text-[var(--v-success)] hover:bg-[rgba(106,176,106,0.2)] transition-colors"
                    style={MONO}
                  >
                    Aprobar
                  </button>
                  <button
                    onClick={() => setRejectId(v.id)}
                    className="px-5 py-2.5 bg-[rgba(224,85,85,0.06)] border border-[rgba(224,85,85,0.2)] rounded-[6px] cursor-pointer text-[9px] font-normal tracking-[.22em] uppercase text-[rgba(224,85,85,0.6)] hover:text-[var(--v-error)] transition-colors"
                    style={MONO}
                  >
                    Rechazar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
