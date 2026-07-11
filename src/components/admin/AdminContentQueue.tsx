'use client'

/**
 * Content moderation queue (mirror of AdminPublications / AdminPerformers).
 * SELF-FETCHING: loads the queue (status in 'uploaded' | 'in_review') from
 * /api/admin/content on mount, then per row lets the admin:
 *   · Ver media   → fetches a short-lived SIGNED URL on demand (GET
 *                   /api/admin/content/[id]) — the private `creator-content`
 *                   media never has a public URL.
 *   · Publicar    → POST .../publish. The DB (content_publish_guard) is the
 *                   authority: until the CSAM scanner (PR-3) passes the piece,
 *                   this comes back 409 "bloqueado" — that's the pillar working.
 *   · Rechazar    → POST .../reject.
 *
 * LIMITES: no signed delivery/watermark to fans (PR-5), no CSAM scan (PR-3),
 * no entitlements/pagos (PR-6+). This is only the moderation surface.
 */

import { useCallback, useEffect, useState } from 'react'

const MONO = { fontFamily: 'var(--v-font-ui)' } as const

type ContentRow = {
  id: string
  creator_id: string
  title: string | null
  media_type: 'image' | 'video' | 'audio' | null
  visibility: 'free_preview' | 'tier' | 'ppv'
  required_tier: string | null
  ppv_price_credits: number | null
  status: string
  csam_status: string
  created_at: string
}

export default function AdminContentQueue({
  notify,
}: {
  notify?: (text: string, type: 'success' | 'error') => void
}) {
  const [content, setContent] = useState<ContentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/content')
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'No se pudo cargar la cola de contenido')
      setContent((data?.content ?? []) as ContentRow[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchQueue()
  }, [fetchQueue])

  async function viewMedia(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/admin/content/${encodeURIComponent(id)}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        notify?.(data?.error || 'No se pudo cargar el media', 'error')
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

  async function publish(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/admin/content/${encodeURIComponent(id)}/publish`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify?.(data?.error || 'No se pudo publicar', 'error')
      } else {
        notify?.('Contenido publicado', 'success')
        await fetchQueue()
      }
    } catch (err) {
      notify?.(err instanceof Error ? err.message : 'Error de red', 'error')
    }
    setBusy(null)
  }

  async function reject(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/admin/content/${encodeURIComponent(id)}/reject`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify?.(data?.error || 'No se pudo rechazar', 'error')
      } else {
        notify?.('Contenido rechazado', 'success')
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
        Contenido Pendiente
        {content.length > 0 && (
          <span
            className="ml-3 text-sm text-[var(--v-accent)] bg-[var(--v-accent)]/10 px-2.5 py-1 rounded-[6px] font-normal"
            style={MONO}
          >
            {content.length}
          </span>
        )}
      </h2>

      {loading && (
        <p className="text-[11px] font-normal text-[var(--v-text-tertiary)]" style={MONO}>Cargando…</p>
      )}
      {error && !loading && (
        <p className="text-[11px] font-normal text-[var(--v-error)]" style={MONO}>{error}</p>
      )}

      {!loading && !error && content.length === 0 ? (
        <p className="text-[11px] font-normal text-[var(--v-text-tertiary)]" style={MONO}>
          No hay contenido pendiente de moderación.
        </p>
      ) : (
        !loading && !error && (
          <div className="flex flex-col gap-3">
            {content.map((c) => (
              <div key={c.id} className="bg-[var(--v-bg-card)] border border-white/5 rounded-[6px] p-5">
                <div className="flex justify-between items-start flex-wrap gap-3 mb-4">
                  <div>
                    <p className="text-[13px] font-normal text-[var(--v-text-primary)] mb-1">
                      {c.title || '(sin título)'}
                    </p>
                    <p className="text-[9px] font-normal text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                      ID {c.id}
                    </p>
                    <p className="text-[9px] font-normal text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                      Creadora {c.creator_id}
                    </p>
                    <p className="text-[9px] font-normal text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                      {c.media_type ?? '—'} · {c.visibility}
                      {c.visibility === 'tier' && c.required_tier ? ` (${c.required_tier})` : ''}
                      {c.visibility === 'ppv' && c.ppv_price_credits ? ` (${c.ppv_price_credits} foguitos)` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span
                      className="text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-accent)] border border-[var(--v-accent)]/20 px-2.5 py-1 rounded-[6px]"
                      style={MONO}
                    >
                      {c.status}
                    </span>
                    <span
                      className="text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-text-tertiary)] border border-white/10 px-2.5 py-1 rounded-[6px]"
                      style={MONO}
                    >
                      CSAM: {c.csam_status}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2.5 flex-wrap">
                  <button
                    onClick={() => viewMedia(c.id)}
                    disabled={busy === c.id}
                    className="px-3.5 py-2 bg-white/5 border border-white/5 rounded-lg cursor-pointer text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors disabled:opacity-50"
                    style={MONO}
                  >
                    Ver Media
                  </button>
                  <button
                    onClick={() => publish(c.id)}
                    disabled={busy === c.id}
                    className="px-5 py-2 bg-[rgba(106,176,106,0.1)] border border-[rgba(106,176,106,0.3)] rounded-lg cursor-pointer text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-success)] hover:bg-[rgba(106,176,106,0.2)] transition-colors disabled:opacity-50"
                    style={MONO}
                  >
                    Publicar
                  </button>
                  <button
                    onClick={() => reject(c.id)}
                    disabled={busy === c.id}
                    className="px-5 py-2 bg-white/5 border border-[var(--v-error)]/30 rounded-lg cursor-pointer text-[8px] font-normal tracking-[.22em] uppercase text-[var(--v-error)] hover:bg-[var(--v-error)]/10 transition-colors disabled:opacity-50"
                    style={MONO}
                  >
                    Rechazar
                  </button>
                </div>

                <p className="mt-3 text-[8px] text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                  La publicación la decide el gate de DB (content_publish_guard): sin CSAM pasado
                  y 2257/verificación 18+ completos, «Publicar» vuelve bloqueado.
                </p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
