'use client'

/**
 * Cola de QUEJAS de moderación (PR-9) — espeja AdminContentQueue.
 * SELF-FETCHING: carga /api/admin/moderation al montar (status open|triaging),
 * y por fila deja al admin:
 *   · Ver contexto → GET /api/admin/content/[id] (SIGNED review media, respeta
 *                    `media_blocked`: una pieza CSAM-blocked nunca se re-firma).
 *   · Takedown     → POST /api/admin/moderation/[id] {action:'takedown'} — baja
 *                    el contenido (content.status='removed') + resuelve la queja.
 *                    Alta-sensibilidad → el server exige TOTP fresca.
 *   · Dismiss      → POST .../[id] {action:'dismiss'}.
 *   · Export       → GET .../[id]/export (referencias, nunca bytes/PII) → descarga.
 *
 * NUNCA auto-takedown: cada acción es un click explícito del admin. La cola no
 * expone `media_ref` (sólo título/creadora/estado + categoría/SLA/overdue).
 */

import { useCallback, useEffect, useState } from 'react'

const MONO = { fontFamily: 'var(--v-font-ui)' } as const

type ContentBrief = {
  id: string
  title: string | null
  creator_id: string
  status: string
}

type Complaint = {
  id: string
  content_id: string | null
  creator_id: string | null
  category: string
  description: string | null
  status: string
  sla_due_at: string | null
  authority_export_status: 'none' | 'generated'
  created_at: string
  overdue: boolean
  content: ContentBrief | null
}

const CATEGORY_LABELS: Record<string, string> = {
  illegal:        'Ilegal',
  dmca:           'DMCA',
  nonconsensual:  'No consentido',
  csam_suspected: 'CSAM (sospecha)',
  spam:           'Spam',
  other:          'Otro',
}

export default function AdminModerationQueue({
  notify,
}: {
  notify?: (text: string, type: 'success' | 'error') => void
}) {
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/moderation')
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'No se pudo cargar la cola de quejas')
      setComplaints((data?.complaints ?? []) as Complaint[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchQueue()
  }, [fetchQueue])

  // 403 con code totp_required ⇒ el admin necesita re-verificar 2FA.
  function handleTotp(status: number, data: { code?: string; error?: string } | null): boolean {
    if (status === 403 && (data?.code === 'totp_required' || data?.code === 'totp_enrollment_required')) {
      notify?.('Verificación 2FA requerida — abrí /auth/totp y reintentá', 'error')
      return true
    }
    return false
  }

  async function viewContext(contentId: string | null) {
    if (!contentId) {
      notify?.('La queja ya no referencia contenido (borrado)', 'error')
      return
    }
    setBusy(contentId)
    try {
      const res = await fetch(`/api/admin/content/${encodeURIComponent(contentId)}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        notify?.(data?.error || 'No se pudo cargar el contexto', 'error')
      } else if (data?.content?.media_blocked) {
        notify?.('Media bloqueada (CSAM): no se re-visualiza. Va por el pipeline NCMEC.', 'error')
      } else if (typeof data?.content?.media_url === 'string') {
        window.open(data.content.media_url, '_blank', 'noopener,noreferrer')
      } else {
        notify?.('Sin media para mostrar', 'error')
      }
    } catch (err) {
      notify?.(err instanceof Error ? err.message : 'Error de red', 'error')
    }
    setBusy(null)
  }

  async function resolve(id: string, action: 'takedown' | 'dismiss') {
    setBusy(id)
    try {
      const res = await fetch(`/api/admin/moderation/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (!handleTotp(res.status, data)) {
          notify?.(data?.error || 'No se pudo resolver', 'error')
        }
      } else {
        notify?.(action === 'takedown' ? 'Contenido dado de baja' : 'Queja descartada', 'success')
        await fetchQueue()
      }
    } catch (err) {
      notify?.(err instanceof Error ? err.message : 'Error de red', 'error')
    }
    setBusy(null)
  }

  async function exportAuthority(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/admin/moderation/${encodeURIComponent(id)}/export`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (!handleTotp(res.status, data)) {
          notify?.(data?.error || 'No se pudo generar el export', 'error')
        }
      } else {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `authority-export-${id}.json`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        notify?.('Export generado (referencias, sin media/PII)', 'success')
        await fetchQueue()
      }
    } catch (err) {
      notify?.(err instanceof Error ? err.message : 'Error de red', 'error')
    }
    setBusy(null)
  }

  return (
    <div className="mt-16 pt-12 border-t border-white/5">
      <h2 className="text-[clamp(20px,3vw,28px)] font-normal text-[var(--v-accent)] mb-6">
        Quejas de Contenido
        {complaints.length > 0 && (
          <span
            className="ml-3 text-sm text-[var(--v-accent)] bg-[var(--v-accent)]/10 px-2.5 py-1 rounded-[6px] font-normal"
            style={MONO}
          >
            {complaints.length}
          </span>
        )}
      </h2>

      {loading && (
        <p className="text-[11px] font-normal text-[var(--v-text-tertiary)]" style={MONO}>Cargando…</p>
      )}
      {error && !loading && (
        <p className="text-[11px] font-normal text-[var(--v-error)]" style={MONO}>{error}</p>
      )}

      {!loading && !error && complaints.length === 0 ? (
        <p className="text-[11px] font-normal text-[var(--v-text-tertiary)]" style={MONO}>
          No hay quejas abiertas.
        </p>
      ) : (
        !loading && !error && (
          <div className="flex flex-col gap-3">
            {complaints.map((c) => (
              <div key={c.id} className="bg-[var(--v-bg-card)] border border-white/5 rounded-[6px] p-5">
                <div className="flex justify-between items-start flex-wrap gap-3 mb-4">
                  <div className="min-w-0">
                    <p className="text-[13px] font-normal text-[var(--v-text-primary)] mb-1">
                      {c.content?.title || '(contenido sin título)'}
                    </p>
                    <p className="text-[9px] font-normal text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                      Queja {c.id}
                    </p>
                    <p className="text-[9px] font-normal text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                      Contenido {c.content_id ?? '— (borrado)'}
                    </p>
                    <p className="text-[9px] font-normal text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                      Creadora {c.creator_id ?? '—'}
                      {c.content ? ` · content: ${c.content.status}` : ''}
                    </p>
                    {c.description && (
                      <p className="mt-2 text-[11px] font-normal text-[var(--v-text-secondary)] whitespace-pre-wrap break-words max-w-[520px]">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span
                      className="text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-accent)] border border-[var(--v-accent)]/20 px-2.5 py-1 rounded-[6px]"
                      style={MONO}
                    >
                      {CATEGORY_LABELS[c.category] ?? c.category}
                    </span>
                    <span
                      className={
                        c.overdue
                          ? 'text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-error)] border border-[var(--v-error)]/40 px-2.5 py-1 rounded-[6px]'
                          : 'text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-text-tertiary)] border border-white/10 px-2.5 py-1 rounded-[6px]'
                      }
                      style={MONO}
                    >
                      {c.overdue ? 'SLA VENCIDO' : 'SLA OK'}
                    </span>
                    <span
                      className="text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-text-tertiary)] border border-white/10 px-2.5 py-1 rounded-[6px]"
                      style={MONO}
                    >
                      {c.status}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2.5 flex-wrap">
                  <button
                    onClick={() => viewContext(c.content_id)}
                    disabled={busy === c.id || busy === c.content_id || !c.content_id}
                    className="px-3.5 py-2 bg-white/5 border border-white/5 rounded-lg cursor-pointer text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors disabled:opacity-50"
                    style={MONO}
                  >
                    Ver Contexto
                  </button>
                  <button
                    onClick={() => resolve(c.id, 'takedown')}
                    disabled={busy === c.id}
                    className="px-5 py-2 bg-white/5 border border-[var(--v-error)]/30 rounded-lg cursor-pointer text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-error)] hover:bg-[var(--v-error)]/10 transition-colors disabled:opacity-50"
                    style={MONO}
                  >
                    Takedown
                  </button>
                  <button
                    onClick={() => resolve(c.id, 'dismiss')}
                    disabled={busy === c.id}
                    className="px-5 py-2 bg-white/5 border border-white/5 rounded-lg cursor-pointer text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-text-tertiary)] hover:text-[var(--v-text-primary)] transition-colors disabled:opacity-50"
                    style={MONO}
                  >
                    Descartar
                  </button>
                  <button
                    onClick={() => exportAuthority(c.id)}
                    disabled={busy === c.id}
                    className="px-5 py-2 bg-[rgba(37,99,235,0.08)] border border-[var(--v-accent)]/30 rounded-lg cursor-pointer text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-accent)] hover:bg-[rgba(37,99,235,0.16)] transition-colors disabled:opacity-50"
                    style={MONO}
                  >
                    Export {c.authority_export_status === 'generated' ? '✓' : ''}
                  </button>
                </div>

                <p className="mt-3 text-[8px] text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                  Takedown baja el contenido (status=removed) — la RLS + los guards cortan la
                  entrega al instante. CSAM se maneja además por el pipeline obligatorio NCMEC.
                </p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
