'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabase/client'
import {
  approveStory as approveStoryAction,
  approveReview as approveReviewAction,
  rejectReview as rejectReviewAction,
  dismissReport as dismissReportAction,
} from '@/lib/admin/actions'
import { recordAuditClient } from '@/lib/audit-client'
import { STORIES_ENABLED, REVIEWS_ENABLED } from '@/config/marketplace.config'
import type {
  AdminReport,
  AdminStoryRow,
  AdminVerification,
  AdminReview,
} from '@/lib/types/admin'

interface Props {
  reports:       AdminReport[]
  stories:       AdminStoryRow[]
  verifications: AdminVerification[]
  reviews:       AdminReview[]
  onRemoveReport:   (id: string) => void
  onRemoveStory:    (id: string) => void
  onRemoveReview:   (id: string) => void
  onRefetchVerifications: () => void
  notify:  (text: string, type: 'success' | 'error') => void
  adminId: string | null
}

type QueueTab = 'all' | 'verif' | 'stories' | 'reports' | 'reviews'

type QueueItem = {
  key:       string
  kind:      'report' | 'story' | 'verification' | 'review'
  id:        string
  postId?:   string
  category?: string
  name:      string
  thumbnail: string | null
  pillKind:  string
  pillKindClass: string
  pillTier:  string | null
  meta:      string
  createdAt: string
  anchor:    string
}

const MONO = { fontFamily: "'Montserrat',sans-serif" } as const

function ago(iso: string | undefined | null): string {
  if (!iso) return ''
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return 'recién'
  const min = Math.floor(diff / 60_000)
  if (min < 60)   return `hace ${min} min`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  if (hr < 24)   return remMin ? `hace ${hr}h ${remMin} min` : `hace ${hr}h`
  const days = Math.floor(hr / 24)
  return `hace ${days}d`
}

function normalize(
  reports: AdminReport[],
  stories: AdminStoryRow[],
  verifications: AdminVerification[],
  reviews: AdminReview[],
): QueueItem[] {
  const items: QueueItem[] = []

  for (const r of reports) {
    items.push({
      key:       `report-${r.id}`,
      kind:      'report',
      id:        r.id,
      postId:    r.post_id,
      category:  r.category,
      name:      r.posts?.title || r.post_id,
      thumbnail: r.posts?.image_urls?.[0] || null,
      pillKind:  'Reporte',
      pillKindClass: 'adm-pill-report',
      pillTier:  null,
      meta:      [
        r.category ? `Motivo: ${humanizeCategory(r.category)}` : null,
        ago(r.created_at),
        r.posts?.localidad || null,
      ].filter(Boolean).join(' · '),
      createdAt: r.created_at,
      anchor:    '#reportes',
    })
  }

  if (STORIES_ENABLED) for (const s of stories) {
    items.push({
      key:       `story-${s.id}`,
      kind:      'story',
      id:        s.id,
      postId:    s.post_id,
      name:      s.posts?.title || s.profiles?.full_name || s.profiles?.email || 'Anunciante',
      thumbnail: s.thumbnail_url || s.posts?.image_urls?.[0] || null,
      pillKind:  'Historia',
      pillKindClass: 'adm-pill-story',
      pillTier:  null,
      meta:      [
        'Video pendiente',
        ago(s.created_at),
      ].filter(Boolean).join(' · '),
      createdAt: s.created_at,
      anchor:    '#historias',
    })
  }

  for (const v of verifications) {
    const archivos: string[] = []
    if (v.identity_doc_url)    archivos.push('DNI')
    if (v.identity_selfie_url) archivos.push('selfie')
    if (v.identity_video_url)  archivos.push('video')
    items.push({
      key:       `verif-${v.id}`,
      kind:      'verification',
      id:        v.id,
      name:      v.full_name || v.email,
      thumbnail: null,
      pillKind:  'Verificación',
      pillKindClass: 'adm-pill-verif',
      pillTier:  null,
      meta:      [
        archivos.length > 0 ? `${archivos.length} archivos: ${archivos.join(' + ')}` : 'Sin archivos',
        ago(v.created_at),
      ].filter(Boolean).join(' · '),
      createdAt: v.created_at,
      anchor:    '#verificaciones',
    })
  }

  if (REVIEWS_ENABLED) for (const rv of reviews) {
    items.push({
      key:       `review-${rv.id}`,
      kind:      'review',
      id:        rv.id,
      name:      rv.reviewer_name || 'Anónimo',
      thumbnail: null,
      pillKind:  'Reseña',
      pillKindClass: 'adm-pill-review',
      pillTier:  null,
      meta:      [
        rv.posts?.title ? `Sobre: ${rv.posts.title}` : null,
        rv.rating ? `${rv.rating}/5` : null,
        ago(rv.created_at),
      ].filter(Boolean).join(' · '),
      createdAt: rv.created_at || new Date().toISOString(),
      anchor:    '#resenas',
    })
  }

  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

function humanizeCategory(cat: string): string {
  const map: Record<string, string> = {
    spam:                  'Spam',
    estafa:                'Estafa',
    contenido_inapropiado: 'Contenido inapropiado',
    contenido_prohibido:   'Contenido prohibido',
    otro:                  'Otro',
  }
  return map[cat] || cat
}

function scrollToAnchor(anchor: string) {
  const id = anchor.replace('#', '')
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function AdminQueue({
  reports, stories, verifications, reviews,
  onRemoveReport, onRemoveStory, onRemoveReview, onRefetchVerifications,
  notify, adminId,
}: Props) {
  const [tab, setTab] = useState<QueueTab>('all')
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const items = useMemo(
    () => normalize(reports, stories, verifications, reviews),
    [reports, stories, verifications, reviews],
  )

  const filtered = useMemo(() => {
    if (tab === 'all') return items
    const kindByTab: Record<Exclude<QueueTab, 'all'>, QueueItem['kind']> = {
      verif:   'verification',
      stories: 'story',
      reports: 'report',
      reviews: 'review',
    }
    return items.filter(i => i.kind === kindByTab[tab])
  }, [items, tab])

  const counts = {
    all:     items.length,
    verif:   verifications.length,
    stories: stories.length,
    reports: reports.length,
    reviews: reviews.length,
  }

  const tabs: Array<{ id: QueueTab; label: string; count: number }> = [
    { id: 'all',     label: 'Todo',         count: counts.all },
    { id: 'verif',   label: 'Verificación', count: counts.verif },
    ...(STORIES_ENABLED ? [{ id: 'stories' as QueueTab, label: 'Historias', count: counts.stories }] : []),
    { id: 'reports', label: 'Reportes',     count: counts.reports },
    ...(REVIEWS_ENABLED ? [{ id: 'reviews' as QueueTab, label: 'Reseñas', count: counts.reviews }] : []),
  ]

  async function approveItem(item: QueueItem) {
    if (busyKey) return
    if (item.kind === 'report') {
      notify('Reports requieren nota — usá "Actuar" en la sección', 'error')
      scrollToAnchor(item.anchor)
      return
    }
    setBusyKey(item.key)
    try {
      if (item.kind === 'story') {
        const result = await approveStoryAction(supabase, item.id)
        if (!result.ok) { notify(result.error, 'error'); return }
        notify('Historia aprobada', 'success')
        onRemoveStory(item.id)
        return
      }
      if (item.kind === 'review') {
        const result = await approveReviewAction(supabase, item.id)
        if (!result.ok) { notify(result.error, 'error'); return }
        notify('Reseña aprobada', 'success')
        onRemoveReview(item.id)
        return
      }
      if (item.kind === 'verification') {
        try {
          const res  = await fetch('/api/admin/verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId: item.id, action: 'approve' }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) { notify(data?.error || 'No se pudo aprobar', 'error'); return }
          void recordAuditClient({
            eventType:   'kyc_approved',
            subjectType: 'profile',
            subjectId:   item.id,
            metadata:    { target_user_id: item.id },
          })
          notify('Verificación aprobada', 'success')
          onRefetchVerifications()
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Error de red al aprobar', 'error')
        }
      }
    } finally {
      setBusyKey(null)
    }
  }

  async function rejectItem(item: QueueItem) {
    if (busyKey) return
    if (item.kind === 'story') {
      notify('Rechazo de historia requiere motivo — completá en la sección', 'error')
      scrollToAnchor(item.anchor)
      return
    }
    if (item.kind === 'verification') {
      notify('Rechazo de verificación requiere motivo — completá en la sección', 'error')
      scrollToAnchor(item.anchor)
      return
    }
    setBusyKey(item.key)
    try {
      if (item.kind === 'report') {
        const result = await dismissReportAction(
          supabase,
          item.id,
          adminId ? { adminId } : undefined,
        )
        if (!result.ok) { notify(result.error, 'error'); return }
        void recordAuditClient({
          eventType:   'report_dismissed',
          subjectType: 'report',
          subjectId:   item.id,
          metadata:    { category: item.category, post_id: item.postId },
        })
        notify('Reporte descartado', 'success')
        onRemoveReport(item.id)
        return
      }
      if (item.kind === 'review') {
        const result = await rejectReviewAction(supabase, item.id)
        if (!result.ok) { notify(result.error, 'error'); return }
        notify('Reseña eliminada', 'success')
        onRemoveReview(item.id)
      }
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <h3>Cola de moderación</h3>
        <div className="adm-card-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`adm-card-tab ${tab === t.id ? 'adm-card-tab-on' : ''}`}
              style={MONO}
            >
              {t.label} <span style={{ opacity: 0.6, marginLeft: 4 }}>{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="adm-queue-body">
        {filtered.length === 0 ? (
          <p className="adm-queue-empty" style={MONO}>
            Sin pendientes en este filtro.
          </p>
        ) : (
          filtered.map(item => {
            const isBusy = busyKey === item.key
            return (
              <div key={item.key} className="adm-queue-row">
                <div className="adm-queue-ph">
                  {item.thumbnail ? (
                    <Image
                      src={item.thumbnail}
                      alt={`Miniatura de ${item.name}`}
                      fill
                      sizes="52px"
                      style={{ objectFit: 'cover' }}
                    />
                  ) : (
                    <span className="adm-queue-ph-fallback">
                      {(item.name?.[0] || '?').toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="adm-queue-info">
                  <div className="adm-queue-row1">
                    <span className="adm-queue-name">{item.name}</span>
                    <span className={`adm-pill ${item.pillKindClass}`} style={MONO}>
                      {item.pillKind}
                    </span>
                    {item.pillTier && (
                      <span className="adm-pill adm-pill-tier" style={MONO}>
                        {item.pillTier}
                      </span>
                    )}
                  </div>
                  <div className="adm-queue-meta" style={MONO}>
                    {item.meta}
                  </div>
                </div>
                <div className="adm-queue-actions">
                  <button
                    type="button"
                    onClick={() => scrollToAnchor(item.anchor)}
                    className="adm-icon-btn"
                    aria-label="Ver en sección"
                    title="Ver detalle"
                    disabled={isBusy}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => approveItem(item)}
                    className="adm-icon-btn adm-icon-btn-ok"
                    aria-label="Aprobar"
                    title={
                      item.kind === 'report'
                        ? 'Reports requieren nota — abre la sección'
                        : 'Aprobar'
                    }
                    disabled={isBusy}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => rejectItem(item)}
                    className="adm-icon-btn adm-icon-btn-bad"
                    aria-label="Rechazar"
                    title={
                      item.kind === 'story' || item.kind === 'verification'
                        ? 'Rechazo requiere motivo — abre la sección'
                        : 'Rechazar'
                    }
                    disabled={isBusy}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
