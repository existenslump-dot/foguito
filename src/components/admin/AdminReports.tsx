'use client'

/**
 * Admin reports moderation panel — "Reportes" section.
 *
 * Queue with a status workflow (pending/actioned/dismissed), tab filters, an
 * internal-note modal for the "Actuar" action, and an audit trail via
 * recordAuditClient. Lets an admin review posts flagged by users and choose:
 *   - Actuar (with note): admin took a concrete action (asked for re-verify,
 *     contacted the advertiser, etc). Status='actioned'. Note required.
 *   - Descartar: admin reviewed and no action is warranted. Status='dismissed'.
 *     Note optional. Admin/timestamp tracking still recorded.
 *   - Eliminar post: shortcut — deletes the post and marks the report as
 *     actioned with an automatic note.
 *
 * Audit: each status change fires recordAuditClient with event
 * 'report_actioned' or 'report_dismissed' + metadata { reason?, category }.
 */

import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase/client'
import Image from 'next/image'
import { postCountrySlug } from '@/lib/geo'
import {
  dismissReport as dismissReportAction,
  deletePostFromReport as deletePostFromReportAction,
  actionReport as actionReportAction,
} from '@/lib/admin/actions'
import { recordAuditClient } from '@/lib/audit-client'

import type { AdminReport } from '@/lib/types/admin'

interface Props {
  reports: AdminReport[]
  /** Removes a report from the parent's list after a mutation. */
  onRemoveReport: (reportId: string) => void
  /** Removes a post from the parent's post list (used after delete). */
  onRemovePost: (postId: string) => void
  notify: (text: string, type: 'success' | 'error') => void
  /** Logged-in admin's id. The parent (admin/page.tsx) already resolves it
   *  via its own auth fetch and passes it here so the actions include
   *  tracking without this component duplicating supabase.auth.getUser()
   *  (which would break tests that don't mock auth). */
  adminId?: string | null
}

const MONO = { fontFamily: "'Montserrat',sans-serif" } as const

const CAT_COLORS: Record<string, string> = {
  spam:                  '#aaa',
  estafa:                '#ff8800',
  contenido_inapropiado: '#ff4444',
  contenido_prohibido:   '#cc0000',
  otro:                  '#888',
}
const CAT_LABELS: Record<string, string> = {
  spam:                  'Spam',
  estafa:                'Estafa',
  contenido_inapropiado: 'Inapropiado',
  contenido_prohibido:   'Prohibido',
  otro:                  'Otro',
}

type StatusFilter = 'pending' | 'actioned' | 'dismissed' | 'all'

export default function AdminReports({ reports, onRemoveReport, onRemovePost, notify, adminId }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  // "Actuar" modal — opens a form for the admin to write the required note.
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [actionNote, setActionNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Filter + sort: pending first, then actioned, then dismissed.
  // Within each bucket, by date DESC.
  const filteredReports = useMemo(() => {
    const filtered = statusFilter === 'all'
      ? reports
      : reports.filter(r => (r.status || 'pending') === statusFilter)
    return [...filtered].sort((a, b) => {
      const statusRank: Record<string, number> = { pending: 0, actioned: 1, dismissed: 2 }
      const sa = statusRank[a.status || 'pending'] ?? 99
      const sb = statusRank[b.status || 'pending'] ?? 99
      if (sa !== sb) return sa - sb
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [reports, statusFilter])

  const counts = useMemo(() => {
    const c = { pending: 0, actioned: 0, dismissed: 0, all: reports.length }
    for (const r of reports) {
      const s = (r.status || 'pending') as keyof typeof c
      if (s === 'pending' || s === 'actioned' || s === 'dismissed') c[s]++
    }
    return c
  }, [reports])

  async function dismiss(report: AdminReport) {
    // adminId optional — if not passed via prop, fall back to legacy
    // behavior (payload only { status: 'dismissed' } without tracking). That
    // keeps the existing tests passing and lets the parent enable tracking
    // just by passing the prop.
    const result = await dismissReportAction(
      supabase,
      report.id,
      adminId ? { adminId } : undefined,
    )
    if (!result.ok) { notify(result.error, 'error'); return }
    void recordAuditClient({
      eventType: 'report_dismissed',
      subjectType: 'report',
      subjectId: report.id,
      metadata: { category: report.category, post_id: report.post_id },
    })
    onRemoveReport(report.id)
    notify('Report descartado', 'success')
  }

  async function actuar() {
    if (!actioningId) return
    if (!actionNote.trim()) { notify('La nota es requerida', 'error'); return }
    if (!adminId) { notify('No se pudo identificar al admin', 'error'); return }
    const report = reports.find(r => r.id === actioningId)
    setSubmitting(true)
    const result = await actionReportAction(supabase, actioningId, { adminId, note: actionNote })
    setSubmitting(false)
    if (!result.ok) { notify(result.error, 'error'); return }
    void recordAuditClient({
      eventType: 'report_actioned',
      subjectType: 'report',
      subjectId: actioningId,
      metadata: {
        category: report?.category,
        post_id: report?.post_id,
        note: actionNote.trim(),
      },
    })
    onRemoveReport(actioningId)
    setActioningId(null)
    setActionNote('')
    notify('Report actuado', 'success')
  }

  async function deletePost(report: AdminReport) {
    const result = await deletePostFromReportAction(
      supabase,
      report.id,
      report.post_id,
      adminId ? { adminId } : undefined,
    )
    if (!result.ok) { notify(result.error, 'error'); return }
    void recordAuditClient({
      eventType: 'post_deleted',
      subjectType: 'post',
      subjectId: report.post_id,
      metadata: {
        deleted_post_title: report.posts?.title ?? null,
        deleted_via: 'report',
        report_id: report.id,
        report_category: report.category,
      },
    })
    void recordAuditClient({
      eventType: 'report_actioned',
      subjectType: 'report',
      subjectId: report.id,
      metadata: { category: report.category, post_id: report.post_id, action: 'post_deleted' },
    })
    onRemoveReport(report.id)
    onRemovePost(report.post_id)
    notify('Publicación eliminada', 'success')
  }

  return (
    <div className="v-fadein d2 mt-16 pt-12 mb-12 border-t border-white/5">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 className="text-[clamp(20px,3vw,28px)] font-normal text-[var(--v-accent)]">
          Reportes
          {counts.pending > 0 && (
            <span
              className="ml-3 text-sm text-[var(--v-accent)] bg-[var(--v-accent)]/10 px-2.5 py-1 rounded-[2px] font-normal"
              style={MONO}
            >
              {counts.pending} pendiente{counts.pending === 1 ? '' : 's'}
            </span>
          )}
        </h2>
        {/* Status filter tabs */}
        <div className="flex gap-1">
          {(['pending', 'actioned', 'dismissed', 'all'] as StatusFilter[]).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className="font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase px-3 py-1.5 rounded-[4px] border cursor-pointer transition-colors"
              style={{
                background: statusFilter === s ? 'rgba(37, 99, 235,0.1)' : 'transparent',
                color: statusFilter === s ? 'var(--v-accent)' : 'var(--v-text-tertiary)',
                borderColor: statusFilter === s ? 'rgba(37, 99, 235,0.4)' : 'rgba(255,255,255,0.1)',
              }}
            >
              {s} ({counts[s]})
            </button>
          ))}
        </div>
      </div>

      {filteredReports.length === 0 ? (
        <p className="text-[9px] font-normal tracking-[.18em] text-[#555]" style={MONO}>
          Sin reportes para este filtro.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filteredReports.map(report => {
            const catColor = CAT_COLORS[report.category] || '#aaa'
            const status = report.status || 'pending'
            const statusColor =
              status === 'pending' ? 'var(--v-accent)'
              : status === 'actioned' ? 'var(--v-success)'
              : 'var(--v-text-tertiary)'

            return (
              <div
                key={report.id}
                className="border rounded-[2px] px-5 py-4 flex flex-wrap items-center gap-4"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderColor: 'rgba(255,255,255,0.05)',
                }}
              >
                <div className="relative w-[52px] h-[52px] flex-shrink-0 border border-white/5 rounded-[2px] bg-[var(--v-bg-base)] overflow-hidden">
                  {report.posts?.image_urls?.[0] && (
                    <Image
                      src={report.posts.image_urls[0]}
                      alt={`Miniatura de ${report.posts?.title || 'publicación reportada'}`}
                      fill
                      sizes="60px"
                      style={{ objectFit: 'cover' }}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-normal text-[var(--v-text-primary)] mb-1.5 overflow-hidden text-ellipsis whitespace-nowrap">
                    {report.posts?.title || report.post_id}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="text-[9px] font-bold tracking-[.22em] uppercase text-[var(--v-bg-base)] px-2 py-0.5 rounded-[2px]"
                      style={{ ...MONO, background: catColor }}
                    >
                      {CAT_LABELS[report.category] || report.category}
                    </span>
                    <span
                      className="text-[9px] font-normal tracking-[.16em] uppercase px-2 py-0.5 rounded-[2px] border"
                      style={{ ...MONO, color: statusColor, borderColor: statusColor + '55' }}
                    >
                      {status}
                    </span>
                    <span className="text-[9px] font-normal text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                      {new Date(report.created_at).toLocaleDateString('es-AR')}
                    </span>
                    {report.description && (
                      <span className="text-[9px] font-normal text-[#9a9490] tracking-[.06em]" style={MONO}>
                        &ldquo;{report.description.slice(0, 80)}{report.description.length > 80 ? '…' : ''}&rdquo;
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <a
                    href={`/${postCountrySlug(report.posts)}/post/${report.post_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="v-admin-btn text-[var(--v-text-secondary)] border-white/10 no-underline inline-flex items-center"
                  >
                    Ver post
                  </a>
                  {status === 'pending' && (
                    <>
                      <button
                        onClick={() => dismiss(report)}
                        className="v-admin-btn text-[var(--v-text-tertiary)] border-white/5"
                      >
                        Descartar
                      </button>
                      <button
                        onClick={() => { setActioningId(report.id); setActionNote('') }}
                        className="v-admin-btn text-[var(--v-success)] border-[rgba(106,176,106,0.25)] bg-[rgba(106,176,106,0.05)]"
                      >
                        Actuar
                      </button>
                      <button
                        onClick={() => deletePost(report)}
                        className="v-admin-btn text-[var(--v-error)] border-[rgba(224,85,85,0.25)] bg-[rgba(224,85,85,0.05)]"
                      >
                        Eliminar post
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* "Actuar (con nota)" modal — note required. */}
      {actioningId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[120] bg-[rgba(8,8,8,0.92)] backdrop-blur-md flex items-center justify-center p-6"
          onClick={() => !submitting && setActioningId(null)}
        >
          <div
            className="bg-[var(--v-bg-card)] border border-white/10 rounded-[6px] p-6 max-w-[480px] w-full"
            onClick={e => e.stopPropagation()}
          >
            <p className="font-['Montserrat',sans-serif] text-[9px] tracking-[.22em] uppercase text-[var(--v-accent)] mb-2">
              Actuar sobre el report
            </p>
            <h3 className="font-['Switzer',sans-serif] text-lg text-white/95 mb-4">
              Nota de la acción tomada
            </h3>
            <p className="font-['Montserrat',sans-serif] text-[10px] text-white/40 leading-relaxed mb-3">
              Describí qué acción tomaste (ej. &ldquo;Publicación dada de baja&rdquo;,
              &ldquo;Pedido de re-verificación al anunciante por email&rdquo;, &ldquo;Advertencia enviada&rdquo;).
              La nota queda en audit interno para coordinación entre admins.
            </p>
            <textarea
              value={actionNote}
              onChange={e => setActionNote(e.target.value)}
              placeholder="Acción tomada…"
              rows={4}
              className="w-full bg-[var(--v-bg-base)] border border-white/10 rounded-[4px] px-3 py-2 text-white text-sm font-['Switzer',sans-serif] resize-y mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setActioningId(null)}
                disabled={submitting}
                className="font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/50 hover:text-[var(--v-accent)] bg-transparent border border-white/10 rounded-[4px] px-4 py-2 cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={actuar}
                disabled={submitting || !actionNote.trim()}
                className="font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase bg-[var(--v-accent)] text-[var(--v-bg-base)] rounded-[4px] px-4 py-2 cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'Guardando…' : 'Confirmar acción'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
