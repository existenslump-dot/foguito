'use client'

/**
 * 2257 review queue (mirror of AdminVerifications). Lists the records still
 * pending certification (`is_complete = false`) — SAFE summaries only, no
 * decrypted PII; each row embeds <AdminPerformerReview/> which loads the full
 * record (decrypted name + signed doc) on demand and exposes the Certify action.
 *
 * Not wired into /admin yet (mounted standalone / for a future
 * /admin/performers route) — see PLAN-DE-TRABAJO. `onRefetch` lets the parent
 * refetch the queue after a certification (a completed record leaves it).
 */

import AdminPerformerReview from './AdminPerformerReview'

const MONO = { fontFamily: "'Montserrat',sans-serif" } as const

export type PerformerSummary = {
  id: string
  added_by: string | null
  custodian: string | null
  is_self: boolean
  is_complete: boolean
  dob_verified: boolean
  created_at: string
}

interface Props {
  performers: PerformerSummary[]
  onRefetch?: () => void
  notify?: (text: string, type: 'success' | 'error') => void
}

export default function AdminPerformers({ performers, onRefetch, notify }: Props) {
  return (
    <div className="mt-16 pt-12 border-t border-white/5">
      <h2 className="text-[clamp(20px,3vw,28px)] font-normal text-[var(--v-accent)] mb-6">
        Registros 2257 Pendientes
        {performers.length > 0 && (
          <span
            className="ml-3 text-sm text-[var(--v-accent)] bg-[var(--v-accent)]/10 px-2.5 py-1 rounded-[6px] font-normal"
            style={MONO}
          >
            {performers.length}
          </span>
        )}
      </h2>

      {performers.length === 0 ? (
        <p className="text-[11px] font-normal text-[var(--v-text-tertiary)]" style={MONO}>
          No hay registros 2257 pendientes.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {performers.map((p) => (
            <div key={p.id} className="bg-[var(--v-bg-card)] border border-white/5 rounded-[6px] p-5">
              <div className="flex justify-between items-start flex-wrap gap-3 mb-4">
                <div>
                  <p className="text-[9px] font-normal text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                    ID {p.id}
                  </p>
                  <p className="text-[9px] font-normal text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                    Cargado por {p.added_by ?? '—'}
                  </p>
                </div>
                <span
                  className="text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-accent)] border border-[var(--v-accent)]/20 px-2.5 py-1 rounded-[6px]"
                  style={MONO}
                >
                  {p.is_self ? 'Self · Pendiente' : 'Colaborador/a · Pendiente'}
                </span>
              </div>

              <AdminPerformerReview performerId={p.id} onCompleted={onRefetch} notify={notify} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
