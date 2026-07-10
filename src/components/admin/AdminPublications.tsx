'use client'

/**
 * Approve is server-side (API) because it bypasses RLS for credit deduction.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase/client'
import { useMarketplaceDialog } from '@/components/ui/MarketplaceDialog'
import { CATEGORIES, TIERS, TIER_COLORS } from '@/lib/categories'
import { postCountrySlug, postCountryName } from '@/lib/geo'
import { COUNTRY_LABEL, STORIES_ENABLED } from '@/config/marketplace.config'
import DashboardStoriesModal from '@/components/dashboard/DashboardStoriesModal'
import PromoModal from '@/components/dashboard/PromoModal'
import {
  rejectPost as rejectPostAction,
  deletePost as deletePostAction,
  togglePostHidden,
  togglePostVerified,
  verifyPostWithId as verifyPostWithIdAction,
  rejectPostIdDocument,
} from '@/lib/admin/actions'
import { recordAuditClient } from '@/lib/audit-client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Post = any
type ProfileMap = Record<string, { credits: number; email: string | null }>

interface Props {
  posts: Post[]
  profileMap: ProfileMap
  onRefetch: () => void
  notify: (text: string, type: 'success' | 'error') => void
}

const MONO = { fontFamily: "'Montserrat',sans-serif" } as const

const IconEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H4v16h16v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)
const IconEye = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
const IconRefresh = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 3v6h-6" />
  </svg>
)
const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)
const IconDiff = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="16 3 21 3 21 8" />
    <line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" />
    <line x1="15" y1="15" x2="21" y2="21" />
    <line x1="4" y1="4" x2="9" y2="9" />
  </svg>
)
const IconShield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)
const IconStory = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="9" strokeDasharray="3 2.5" />
    <circle cx="12" cy="12" r="4.5" />
  </svg>
)
const IconPromo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12 12 4l7 8M12 4v16" />
  </svg>
)
const IconEyeOff = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
)
const IconLink = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
)
const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
)
const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)
const IconBadge = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z" />
  </svg>
)

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`
}
function daysUntil(iso: string) {
  return Math.floor((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

type AdminTabId = 'all' | 'pendientes' | 'activas' | 'vencidas' | 'borradores'

const ADMIN_TABS: Array<{ id: AdminTabId; label: string }> = [
  { id: 'all',         label: 'Todas'      },
  { id: 'pendientes',  label: 'Pendientes' },
  { id: 'activas',     label: 'Activas'    },
  { id: 'vencidas',    label: 'Vencidas'   },
  { id: 'borradores',  label: 'Borradores' },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function postMatchesTab(post: any, tab: AdminTabId, nowMs: number): boolean {
  if (tab === 'all') return true
  const expiresAt = post.expires_at
    ? new Date(post.expires_at).getTime()
    : (post.published_at
        ? new Date(post.published_at).getTime() + 30 * 24 * 60 * 60 * 1000
        : null)
  const expired = expiresAt !== null && expiresAt < nowMs
  const isPublished = post.is_approved && post.status === 'published'
  switch (tab) {
    case 'pendientes': return post.status === 'pending' || post.status === 'revision'
    case 'activas':    return isPublished && !expired && !post.is_hidden
    case 'vencidas':   return isPublished && expired
    case 'borradores': return post.status === 'draft' || post.status === 'rejected'
  }
}

export default function AdminPublications({ posts, profileMap, onRefetch, notify }: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab]     = useState<AdminTabId>('all')

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!menuOpenId) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpenId])

  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [rejectingId, setRejectingId]   = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [isRejecting, setIsRejecting]   = useState(false)
  const [deletingPost, setDeletingPost] = useState<{ id: string; title: string; user_id?: string | null } | null>(null)
  const [renovarOpenId, setRenovarOpenId] = useState<string | null>(null)
  const [renewingId, setRenewingId]       = useState<string | null>(null)
  // Pass the post owner's user_id (not the admin's session id) so the story
  // row is attributed correctly — otherwise feeds filtered by owner would
  // miss admin-created stories.
  const [managingStories, setManagingStories] = useState<{
    postId: string; postTitle: string; ownerId: string | null
  } | null>(null)
  const [managingPromoPost, setManagingPromoPost] = useState<Post | null>(null)
  const [diffState, setDiffState] = useState<
    | { revision: Post; parent: Post | null; loading: false }
    | { revision: Post; parent: null; loading: true }
    | null
  >(null)
  const dlg = useMarketplaceDialog()

  // Captured once at mount via a lazy useState initializer — that path is
  // pure under the React Compiler rules (the factory runs exactly once on
  // the initial render, not on every re-render like a useMemo body would).
  const [nowMs] = useState(() => Date.now())

  async function handleApprove(post: Post) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/admin/approve-post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ postId: post.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        notify('Error: ' + (data.error || 'desconocido'), 'error')
        return
      }
      notify('Publicación aprobada', 'success')
      setConfirmingId(null)
      onRefetch()
    } catch (err) {
      notify('Error crítico al aprobar: ' + (err instanceof Error ? err.message : String(err)), 'error')
    }
  }

  async function submitReject() {
    if (!rejectingId || !rejectReason.trim()) {
      notify('Escribe un motivo', 'error')
      return
    }
    setIsRejecting(true)
    const result = await rejectPostAction(supabase, rejectingId, rejectReason)
    setIsRejecting(false)
    if (!result.ok) { notify(result.error, 'error'); return }
    void recordAuditClient({
      eventType: 'post_rejected',
      subjectType: 'post',
      subjectId: rejectingId,
      metadata: { reason: rejectReason },
    })
    notify('Anuncio rechazado', 'success')
    setRejectingId(null)
    setRejectReason('')
    onRefetch()
  }

  async function toggleVerificada(post: Post) {
    const result = await togglePostVerified(supabase, post.id, !post.identity_verified)
    if (!result.ok) { notify(result.error, 'error'); return }
    notify(post.identity_verified ? 'Verificación removida' : 'Perfil verificado', 'success')
    onRefetch()
  }

  async function viewIdDoc(path: string) {
    const win = window.open('', '_blank')
    const { data, error } = await supabase.storage
      .from('id-documents')
      .createSignedUrl(path, 60)
    if (error || !data?.signedUrl) {
      win?.close()
      notify('No se pudo generar el enlace', 'error')
      return
    }
    if (win) win.location.href = data.signedUrl
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function verifyWithId(postId: string) {
    const result = await verifyPostWithIdAction(supabase, postId)
    if (!result.ok) { notify(result.error, 'error'); return }
    notify('Perfil verificado con documento', 'success')
    onRefetch()
  }

  async function rejectIdDoc(postId: string) {
    const result = await rejectPostIdDocument(supabase, postId)
    if (!result.ok) { notify(result.error, 'error'); return }
    notify('Documento rechazado y verificación removida', 'success')
    onRefetch()
  }

  async function confirmDelete() {
    if (!deletingPost) return
    const deletedPostId = deletingPost.id
    const deletedPostOwner = deletingPost.user_id
    const deletedPostTitle = deletingPost.title
    const result = await deletePostAction(supabase, deletedPostId)
    if (!result.ok) { notify('Error al eliminar: ' + result.error, 'error'); return }
    void recordAuditClient({
      eventType: 'post_deleted',
      subjectType: 'post',
      subjectId: deletedPostId,
      metadata: {
        deleted_post_owner_user_id: deletedPostOwner,
        deleted_post_title: deletedPostTitle,
      },
    })
    notify('Publicación eliminada', 'success')
    setDeletingPost(null)
    onRefetch()
  }

  async function toggleHidden(post: Post) {
    const newHidden = !post.is_hidden
    const result = await togglePostHidden(supabase, post.id, newHidden)
    if (!result.ok) { notify('Error al actualizar visibilidad', 'error'); return }
    notify(newHidden ? 'Publicación oculta del listado' : 'Publicación visible en el listado', 'success')
    onRefetch()
  }

  async function openDiff(revision: Post) {
    if (!revision.parent_post_id) {
      notify('Esta revisión no referencia un post padre', 'error')
      return
    }
    setDiffState({ revision, parent: null, loading: true })
    const { data: parent, error } = await supabase
      .from('posts')
      .select('*')
      .eq('id', revision.parent_post_id)
      .single()
    if (error || !parent) {
      notify('No se pudo cargar el post padre para comparar', 'error')
      setDiffState(null)
      return
    }
    setDiffState({ revision, parent, loading: false })
  }

  async function renewPost(post: Post, days: number) {
    setRenewingId(post.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/admin/renew-post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ postId: post.id, days }),
      })
      const data = await res.json()
      if (!res.ok) {
        notify('Error renovando: ' + (data.error || 'desconocido'), 'error')
        return
      }
      notify(`Vigencia extendida ${days} días`, 'success')
      setRenovarOpenId(null)
      onRefetch()
    } finally {
      setRenewingId(null)
    }
  }

  async function associateByEmail(postId: string) {
    const email = await dlg.prompt('Email de la cuenta a asociar con esta publicación:', {
      title: 'Asociar publicación',
      placeholder: 'email@ejemplo.com',
      confirmLabel: 'Asociar',
    })
    if (!email?.trim()) return
    const { data: profile, error: pErr } = await supabase
      .from('profiles').select('id, email').eq('email', email.trim().toLowerCase()).maybeSingle()
    if (pErr) {
      notify('Error consultando la cuenta: ' + pErr.message, 'error')
      return
    }
    if (!profile) {
      notify('No hay ninguna cuenta con ese email. Creá el usuario en /registro primero.', 'error')
      return
    }
    const profileId = (profile as { id: string }).id
    const { error: uErr } = await supabase.from('posts').update({ user_id: profileId }).eq('id', postId)
    if (uErr) { notify('No se pudo asociar: ' + uErr.message, 'error'); return }
    notify(`Publicación asociada a ${email.trim().toLowerCase()}`, 'success')
    onRefetch()
  }

  const tabCounts = useMemo(() => {
    const map: Record<AdminTabId, number> = { all: posts.length, pendientes: 0, activas: 0, vencidas: 0, borradores: 0 }
    for (const p of posts) {
      for (const tab of ADMIN_TABS) {
        if (tab.id === 'all') continue
        if (postMatchesTab(p, tab.id, nowMs)) map[tab.id]++
      }
    }
    return map
  }, [posts, nowMs])

  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return posts.filter(p => {
      if (!postMatchesTab(p, activeTab, nowMs)) return false
      if (!q) return true
      const hay = `${p.title ?? ''} ${p.localidad ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [posts, searchQuery, activeTab, nowMs])

  return (
    <>
      {dlg.dialog}
      <div className="adm-card mb-7">
        <div className="adm-card-head adm-card-head-stack">
          <div className="adm-card-head-row">
            <h3 className="adm-card-head-h3-with-chip">
              Publicaciones
              {posts.length > 0 && (
                <span className="adm-card-head-chip" style={MONO}>
                  {posts.length}
                </span>
              )}
            </h3>
            {posts.length > 0 && (
              <div className="adm-search-input">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="11" cy="11" r="7"/>
                  <path d="m20 20-3.5-3.5" strokeLinecap="round"/>
                </svg>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Nombre, barrio…"
                  aria-label="Buscar publicaciones"
                  style={MONO}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Limpiar búsqueda"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
          {posts.length > 0 && (
            <div className="adm-card-tabs" role="tablist" aria-label="Filtros de estado">
              {ADMIN_TABS.map(tab => {
                const isActive = activeTab === tab.id
                const count = tabCounts[tab.id]
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={`adm-card-tab ${isActive ? 'adm-card-tab-on' : ''}`}
                    style={MONO}
                  >
                    {tab.label} <span style={{ opacity: 0.6, marginLeft: 4 }}>{count}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

      <div className="v-fadein d3 flex flex-col gap-3 p-5">
        {posts.length === 0 ? (
          <div className="text-center px-6 py-20 border border-dashed border-white/5 rounded-[6px]">
            <p className="text-[9px] font-normal tracking-[.24em] uppercase text-[var(--v-text-tertiary)]" style={MONO}>
              La bóveda de contenido está vacía.
            </p>
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="text-center px-6 py-16 border border-dashed border-white/5 rounded-[6px]">
            <p className="text-[9px] font-normal tracking-[.24em] uppercase text-[var(--v-text-tertiary)] mb-3" style={MONO}>
              Sin resultados
            </p>
            <p className="text-[11px] text-[var(--v-text-tertiary)]" style={MONO}>
              {searchQuery
                ? `No hay publicaciones que coincidan con "${searchQuery}" en este filtro.`
                : 'Ninguna publicación entra en este filtro ahora mismo.'}
            </p>
          </div>
        ) : (
          filteredPosts.map(post => {
            const isPending    = post.status === 'pending'
            const isRevision   = post.status === 'revision'
            const isRejected   = post.status === 'rejected'
            const isDraft      = post.status === 'draft'
            const isPublished  = post.is_approved && post.status === 'published'
            const isActionable = isPending || isRevision
            const tierDef   = TIERS.find(t => t.id === post.tier)
            const tierColor = post.tier ? (TIER_COLORS[post.tier] || 'var(--v-text-tertiary)') : null
            const catDef    = CATEGORIES.find(c => c.id === post.category)
            const _userCredits = post.user_id ? (profileMap[post.user_id]?.credits ?? null) : null
            void _userCredits
            const ownerEmail = post.user_id ? (profileMap[post.user_id]?.email ?? null) : null
            const emailShort = ownerEmail && ownerEmail.length > 24
              ? `${ownerEmail.slice(0, 12)}…@${ownerEmail.split('@')[1] ?? ''}`
              : ownerEmail
            const updatedAt = post.updated_at ? new Date(post.updated_at).getTime() : null
            const createdAt = post.created_at ? new Date(post.created_at).getTime() : null
            const recentlyModified = !!(updatedAt && createdAt && updatedAt - createdAt > 60_000 && nowMs - updatedAt < 24 * 60 * 60 * 1000)

            const referenceDateIso = post.published_at ?? post.created_at
            const effectiveExpiresAt = post.expires_at
              || (referenceDateIso
                    ? new Date(new Date(referenceDateIso).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
                    : null)
            const expired   = effectiveExpiresAt ? new Date(effectiveExpiresAt).getTime() < nowMs : false
            const daysLeft  = effectiveExpiresAt ? daysUntil(effectiveExpiresAt) : null
            const expiryColor = daysLeft === null ? 'var(--v-text-tertiary)'
              : daysLeft < 7   ? 'var(--v-error)'
              : daysLeft < 15  ? 'var(--v-accent)'
              : 'var(--v-text-tertiary)'

            const accentColor =
              isPending || isRevision ? 'var(--v-accent)'
              : isRejected            ? 'var(--v-error)'
              : expired && isPublished ? 'var(--v-error)'
              : isDraft               ? 'rgba(37, 99, 235,0.35)'
              : isPublished && tierColor ? tierColor
              : 'rgba(255,255,255,0.08)'

            const statusInfo = isRevision
              ? { color: 'var(--v-accent)', label: 'En revisión' }
              : expired && isPublished
                ? { color: 'var(--v-error)', label: 'Expirada' }
                : isPublished
                  ? { color: 'var(--v-success)', label: 'Publicado' }
                  : isPending
                    ? { color: 'var(--v-accent)', label: 'Pendiente' }
                    : isDraft
                      ? { color: 'var(--v-accent)', label: 'Borrador' }
                      : isRejected
                        ? { color: 'var(--v-error)', label: 'Rechazado' }
                        : { color: '#9a9490', label: String(post.status) }

            return (
              <div
                key={post.id}
                className={`v-admin-card${post.is_hidden ? ' v-post-hidden' : ''}`}
                style={{ borderLeft: `3px solid ${accentColor}` }}
              >
                <div className="v-admin-card-body">
                  <div className="v-admin-card-thumb">
                    {post.image_urls?.[0] && (
                      <Image
                        src={post.image_urls[0]}
                        alt={`Miniatura de ${post.title}`}
                        fill
                        sizes="110px"
                        style={{ objectFit: 'cover' }}
                      />
                    )}
                    {isRevision && (
                      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(37,99,235,0.15)_0%,transparent_60%)]" />
                    )}
                  </div>

                  <div className="v-admin-card-info">
                    <div className="v-admin-card-toprow">
                      <h3 className="v-admin-card-name">
                        {post.title}
                        {post.identity_verified && (
                          <span
                            aria-label="Verificado"
                            title="Perfil verificado"
                            className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-full bg-[var(--v-accent)] text-[var(--v-bg-base)] text-[9px] font-bold ml-2 align-middle"
                          >✓</span>
                        )}
                      </h3>
                      <span className="v-admin-card-price" style={MONO}>
                        {post.price_usd
                          ? `USD ${Number(post.price_usd).toLocaleString('en-US')}`
                          : `$${Number(post.price || 0).toLocaleString('es-CL')} ${post.currency || ''}`.trim()}
                      </span>
                      <span
                        className="inline-flex items-center gap-1.5 text-[8px] tracking-[.22em] uppercase"
                        style={{ ...MONO, color: statusInfo.color }}
                      >
                        <span
                          className="w-[6px] h-[6px] rounded-full"
                          style={{ background: statusInfo.color }}
                        />
                        {statusInfo.label}
                      </span>
                      {tierDef && tierColor && (
                        <span
                          className="text-[7px] font-normal tracking-[.2em] uppercase px-2 h-[20px] inline-flex items-center rounded-[6px]"
                          style={{ ...MONO, color: tierColor, border: `1px solid ${tierColor}44` }}
                        >
                          {tierDef.label}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {(() => {
                        const parts = (post.localidad || '')
                          .split(',').map((p: string) => p.trim()).filter(Boolean) as string[]
                        const list = parts.length > 0
                          ? parts
                          : [postCountryName(post) || COUNTRY_LABEL]
                        return list.map((part: string) => (
                          <span
                            key={part}
                            className="text-[11px] font-normal text-[var(--v-text-secondary)] border border-[rgba(37,99,235,0.10)] px-2.5 py-1 inline-flex items-center rounded-[4px]"
                            style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif" }}
                          >
                            {part}
                          </span>
                        ))
                      })()}

                      {catDef && (
                        <span
                          className="text-[11px] font-normal text-[var(--v-text-secondary)] border border-[rgba(37,99,235,0.10)] px-2.5 py-1 inline-flex items-center rounded-[4px]"
                          style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif" }}
                        >
                          {catDef.label}
                        </span>
                      )}

                      {ownerEmail && (
                        <span
                          title={`Asociado a: ${ownerEmail}${recentlyModified ? ' · modificado últimas 24 h' : ''}`}
                          className="text-[10px] font-normal tracking-[.08em] px-2.5 h-[22px] inline-flex items-center gap-1.5 rounded-[6px] max-w-[220px] overflow-hidden whitespace-nowrap text-[var(--v-accent-strong)] bg-[var(--v-accent)]/10 border border-[var(--v-accent)]/20"
                          style={MONO}
                        >
                          {recentlyModified && (
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-[var(--v-accent)] flex-shrink-0 shadow-[0_0_6px_rgba(37,99,235,0.6)]"
                            />
                          )}
                          <span className="overflow-hidden text-ellipsis">{emailShort}</span>
                        </span>
                      )}
                      {!ownerEmail && post.user_id && (
                        <span
                          title="Sin profile (el user nunca se logueó)"
                          className="text-[10px] font-normal tracking-[.08em] px-2.5 h-[22px] inline-flex items-center rounded-[6px] text-[var(--v-text-tertiary)] bg-white/5 border border-dashed border-white/10"
                          style={MONO}
                        >
                          sin profile
                        </span>
                      )}
                    </div>

                    {isPublished && (
                      <div className="flex flex-wrap gap-4 mt-1">
                        {referenceDateIso && (
                          <span className="text-[7px] font-normal tracking-[.22em] uppercase text-[var(--v-text-secondary)]" style={MONO}>
                            Publicado: {formatDate(referenceDateIso)}
                          </span>
                        )}
                        {daysLeft !== null && !expired && (
                          <span className="text-[7px] font-normal tracking-[.22em] uppercase" style={{ ...MONO, color: expiryColor }}>
                            Vence en {daysLeft} día{daysLeft !== 1 ? 's' : ''}
                          </span>
                        )}
                        {expired && (
                          <span className="text-[7px] font-normal tracking-[.22em] uppercase text-[var(--v-error)]" style={MONO}>
                            Expirada hace {Math.abs(daysLeft ?? 0)} día{Math.abs(daysLeft ?? 0) !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="v-admin-card-actions">
                    {isActionable && (
                      confirmingId === post.id ? (
                        <>
                          <button
                            onClick={() => handleApprove(post)}
                            className="v-admin-btn-v2 text-[var(--v-success)] border-[rgba(100,180,100,0.25)] bg-[rgba(100,180,100,0.06)]"
                          ><IconCheck /> Confirmar</button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="v-admin-btn-v2 text-[var(--v-text-tertiary)] border-white/5 !w-9 !px-0"
                            aria-label="Cancelar"
                          ><IconX /></button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setConfirmingId(post.id)}
                            className="v-admin-btn-v2 text-[var(--v-accent)] border-[var(--v-accent)]/25 bg-[var(--v-accent)]/5 hover:bg-[var(--v-accent)] hover:text-[var(--v-bg-base)] transition-colors"
                          ><IconCheck /> Aprobar</button>
                          <button
                            onClick={() => setRejectingId(post.id)}
                            className="v-admin-btn-v2 text-[var(--v-accent)]/70 border-[var(--v-accent)]/20 hover:text-[var(--v-accent)] hover:border-[var(--v-accent)]/50 hover:bg-[var(--v-accent)]/10 transition-colors"
                          ><IconX /> Rechazar</button>
                        </>
                      )
                    )}

                    {isRevision && post.parent_post_id && (
                      <button
                        onClick={() => openDiff(post)}
                        className="v-admin-btn-v2 text-[var(--v-accent)] border-[var(--v-accent)]/25 hover:border-[var(--v-accent)]/50 hover:bg-[var(--v-accent)]/10 transition-colors"
                      ><IconDiff /> Ver cambios</button>
                    )}

                    <Link
                      href={`/admin/edit/${post.id}`}
                      className="v-admin-btn-v2 text-[var(--v-text-secondary)] border-[rgba(37,99,235,0.10)] no-underline hover:text-[var(--v-accent)] hover:border-[var(--v-accent)]/40 hover:bg-[var(--v-accent)]/5 transition-colors"
                    ><IconEdit /> Editar</Link>

                    <Link
                      href={`/${postCountrySlug(post)}/post/${post.id}?from=admin`}
                      className="v-admin-btn-v2 text-[var(--v-text-secondary)] border-[rgba(37,99,235,0.10)] no-underline hover:text-[var(--v-accent)] hover:border-[var(--v-accent)]/40 hover:bg-[var(--v-accent)]/5 transition-colors"
                    ><IconEye /> Ver</Link>

                    {isPublished && (
                      renovarOpenId === post.id ? (
                        <>
                          <button
                            onClick={() => renewPost(post, 7)}
                            disabled={renewingId === post.id}
                            className="v-admin-btn-v2 text-[var(--v-accent)] border-[var(--v-accent)]/25 hover:bg-[var(--v-accent)]/10 disabled:opacity-50 transition-colors"
                          >+7d</button>
                          <button
                            onClick={() => renewPost(post, 15)}
                            disabled={renewingId === post.id}
                            className="v-admin-btn-v2 text-[var(--v-accent)] border-[var(--v-accent)]/25 hover:bg-[var(--v-accent)]/10 disabled:opacity-50 transition-colors"
                          >+15d</button>
                          <button
                            onClick={() => renewPost(post, 30)}
                            disabled={renewingId === post.id}
                            className="v-admin-btn-v2 text-[var(--v-accent)] border-[var(--v-accent)]/25 hover:bg-[var(--v-accent)]/10 disabled:opacity-50 transition-colors"
                          >+30d</button>
                          <button
                            onClick={() => setRenovarOpenId(null)}
                            disabled={renewingId === post.id}
                            className="v-admin-btn-v2 text-[var(--v-text-tertiary)] border-white/5 disabled:opacity-50 !w-9 !px-0"
                            aria-label="Cancelar"
                          ><IconX /></button>
                        </>
                      ) : (
                        <button
                          onClick={() => setRenovarOpenId(post.id)}
                          className="v-admin-btn-v2 primary text-[var(--v-bg-base)] border-[var(--v-accent)] bg-[var(--v-accent)] hover:bg-[var(--v-accent-light)] transition-colors"
                        ><IconRefresh /> Renovar</button>
                      )
                    )}

                    <div className="relative" ref={menuOpenId === post.id ? menuRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setMenuOpenId(menuOpenId === post.id ? null : post.id)}
                        aria-haspopup="menu"
                        aria-expanded={menuOpenId === post.id}
                        aria-label="Más acciones"
                        className="v-admin-btn-v2 text-[var(--v-accent)] border-[var(--v-accent)]/25 hover:border-[var(--v-accent)]/50 hover:bg-[var(--v-accent)]/10 transition-colors text-[16px] font-bold !w-9 !px-0"
                      >⋯</button>
                      {menuOpenId === post.id && (
                        <div
                          role="menu"
                          className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-[6px] border border-[var(--v-accent)]/25 bg-[var(--v-bg-elevated)] shadow-[0_8px_24px_rgba(0,0,0,0.6)] py-1.5"
                        >
                          <AdminMenuItem
                            icon={<IconBadge />}
                            onClick={() => { toggleVerificada(post); setMenuOpenId(null) }}
                          >
                            {post.identity_verified ? 'Quitar verificación' : 'Marcar verificado'}
                          </AdminMenuItem>
                          {STORIES_ENABLED && (
                            <AdminMenuItem
                              icon={<IconStory />}
                              onClick={() => {
                                if (!post.user_id) return
                                setManagingStories({ postId: post.id, postTitle: post.title, ownerId: post.user_id ?? null })
                                setMenuOpenId(null)
                              }}
                              disabled={!post.user_id}
                              title={post.user_id ? undefined : 'Asociá la publicación a un usuario primero'}
                            >
                              Historias
                            </AdminMenuItem>
                          )}
                          <AdminMenuItem
                            icon={<IconPromo />}
                            onClick={() => { setManagingPromoPost(post); setMenuOpenId(null) }}
                          >
                            {post.is_promoted ? 'Editar promoción' : 'Promoción'}
                          </AdminMenuItem>
                          <AdminMenuItem
                            icon={<IconEyeOff />}
                            onClick={() => { toggleHidden(post); setMenuOpenId(null) }}
                          >
                            {post.is_hidden ? 'Mostrar en catálogo' : 'Ocultar del catálogo'}
                          </AdminMenuItem>
                          <AdminMenuItem
                            icon={<IconLink />}
                            onClick={() => { associateByEmail(post.id); setMenuOpenId(null) }}
                          >
                            Asociar a usuario
                          </AdminMenuItem>
                          <AdminMenuLink
                            icon={<IconFile />}
                            href="/dashboard/verify"
                            target="_blank"
                          >
                            Documentación
                          </AdminMenuLink>
                          {!isActionable && (
                            <AdminMenuItem
                              icon={<IconX />}
                              onClick={() => { setRejectingId(post.id); setMenuOpenId(null) }}
                            >
                              Rechazar
                            </AdminMenuItem>
                          )}
                          <div className="my-1 mx-2 h-px bg-white/5" />
                          <AdminMenuItem
                            icon={<IconTrash />}
                            onClick={() => { setDeletingPost({ id: post.id, title: post.title, user_id: post.user_id }); setMenuOpenId(null) }}
                            danger
                          >
                            Eliminar publicación
                          </AdminMenuItem>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {post.id_document_url && (
                  <div className="v-admin-card-iddoc-row">
                    <span
                      className="text-[10px] font-medium tracking-[.04em] text-[var(--v-accent)]"
                      style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif" }}
                    >
                      Documento de identidad recibido:
                    </span>
                    <button
                      onClick={() => viewIdDoc(post.id_document_url)}
                      className="v-admin-btn-v2 text-[var(--v-accent)] border-[var(--v-accent)]/25 bg-[var(--v-accent)]/5 hover:bg-[var(--v-accent)]/10 hover:border-[var(--v-accent)]/45 transition-colors"
                    ><IconEye /> Ver ID</button>
                    <button
                      onClick={() => verifyWithId(post.id)}
                      className="v-admin-btn-v2 text-[var(--v-accent)] border-[var(--v-accent)]/25 bg-[var(--v-accent)]/5 hover:bg-[var(--v-accent)]/10 hover:border-[var(--v-accent)]/45 transition-colors"
                    ><IconShield /> Verificar con ID</button>
                    <button
                      onClick={() => rejectIdDoc(post.id)}
                      className="v-admin-btn-v2 text-[var(--v-accent)]/70 border-[var(--v-accent)]/20 hover:text-[var(--v-accent)] hover:border-[var(--v-accent)]/50 hover:bg-[var(--v-accent)]/10 transition-colors"
                    ><IconX /> Rechazar ID</button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
      </div>

      {deletingPost && (
        <div
          className="fixed inset-0 z-[110] bg-[var(--v-bg-base)]/95 backdrop-blur-md flex items-center justify-center p-6"
          onClick={() => setDeletingPost(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-[var(--v-bg-card)] border border-[rgba(224,85,85,0.25)] rounded-[6px] p-10 max-w-[420px] w-full"
          >
            <p
              className="text-[7px] font-normal tracking-[.26em] uppercase text-[var(--v-error)] mb-6"
              style={MONO}
            >
              Eliminar publicación
            </p>
            <p className="text-[clamp(20px,3vw,26px)] font-normal text-[var(--v-text-primary)] mb-4 leading-[1.2]">
              &iquest;Eliminar <span className="text-[var(--v-accent)]">{deletingPost.title}</span> de forma permanente?
            </p>
            <p
              className="text-[9px] font-normal tracking-[.18em] text-[var(--v-text-tertiary)] mb-8"
              style={MONO}
            >
              Esta acci&oacute;n no se puede deshacer. Se eliminar&aacute;n todos los datos, fotos y videos.
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmDelete}
                className="flex-1 bg-[rgba(224,85,85,0.1)] text-[var(--v-error)] p-3.5 rounded-[6px] border border-[rgba(224,85,85,0.25)] cursor-pointer text-[9px] font-normal tracking-[.18em] uppercase"
                style={MONO}
              >
                Eliminar
              </button>
              <button
                onClick={() => setDeletingPost(null)}
                className="flex-1 bg-transparent text-[var(--v-text-tertiary)] p-3.5 rounded-[6px] border border-white/5 cursor-pointer text-[9px] font-normal tracking-[.18em] uppercase"
                style={MONO}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {STORIES_ENABLED && managingStories && (
        <DashboardStoriesModal
          open={{ postId: managingStories.postId, postTitle: managingStories.postTitle }}
          userId={managingStories.ownerId}
          posts={posts.filter(p => p.id === managingStories.postId)}
          onClose={() => { setManagingStories(null); onRefetch() }}
          onNotify={notify}
          autoApprove
        />
      )}

      {managingPromoPost && (
        <PromoModal
          post={managingPromoPost}
          onClose={() => setManagingPromoPost(null)}
          onUpdated={() => { onRefetch() }}
          onNotify={notify}
        />
      )}

      {diffState && <RevisionDiffModal state={diffState} onClose={() => setDiffState(null)} />}

      {rejectingId && (
        <div className="fixed inset-0 z-[110] bg-[var(--v-bg-base)]/95 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-[var(--v-bg-elevated)] border border-[rgba(224,85,85,0.2)] rounded-[6px] p-10 max-w-[440px] w-full">
            <div className="flex items-center gap-2 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--v-error)] inline-block" />
              <p className="text-[9px] font-normal tracking-[.2em] uppercase text-[var(--v-accent)]" style={MONO}>
                Motivo del Rechazo
              </p>
            </div>
            <textarea
              className="w-full bg-[var(--v-bg-base)] border border-white/5 p-4 rounded-[6px] outline-none text-[11px] font-normal text-[#E0DAD0] resize-none h-[140px] mb-6 leading-[1.7] transition-colors focus:border-[rgba(224,85,85,0.35)]"
              style={MONO}
              placeholder="Escribe la razón para que el usuario pueda corregirlo..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
            <div className="flex gap-3">
              <button
                onClick={submitReject}
                disabled={isRejecting}
                className="flex-1 bg-[rgba(224,85,85,0.9)] text-white p-3.5 rounded-[6px] border-0 cursor-pointer text-[9px] font-normal tracking-[.18em] uppercase transition-colors disabled:opacity-50"
                style={MONO}
              >
                Confirmar
              </button>
              <button
                onClick={() => setRejectingId(null)}
                className="flex-1 bg-transparent text-[var(--v-text-tertiary)] p-3.5 rounded-[6px] border border-white/5 cursor-pointer text-[9px] font-normal tracking-[.18em] uppercase transition-colors"
                style={MONO}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const MENU_ITEM_BASE =
  'flex w-full items-center gap-2.5 text-left px-3 py-2 text-[12px] font-normal transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const MENU_ITEM_DEFAULT =
  'text-[var(--v-text-secondary)] hover:text-[var(--v-accent)] hover:bg-[var(--v-accent)]/8'
const MENU_ITEM_DANGER =
  'text-[var(--v-error)]/80 hover:text-[var(--v-error)] hover:bg-[var(--v-error)]/8'

function AdminMenuItem({
  onClick,
  disabled,
  danger,
  title,
  icon,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${MENU_ITEM_BASE} ${danger ? MENU_ITEM_DANGER : MENU_ITEM_DEFAULT}`}
      style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif" }}
    >
      {icon && <span className="flex-shrink-0 w-[14px] h-[14px] inline-flex items-center justify-center [&_svg]:w-full [&_svg]:h-full">{icon}</span>}
      <span className="flex-1">{children}</span>
    </button>
  )
}

function AdminMenuLink({
  href,
  target,
  icon,
  children,
}: {
  href: string
  target?: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      target={target}
      rel={target === '_blank' ? 'noopener noreferrer' : undefined}
      role="menuitem"
      className={`${MENU_ITEM_BASE} ${MENU_ITEM_DEFAULT} no-underline`}
      style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif" }}
    >
      {icon && <span className="flex-shrink-0 w-[14px] h-[14px] inline-flex items-center justify-center [&_svg]:w-full [&_svg]:h-full">{icon}</span>}
      <span className="flex-1">{children}</span>
    </Link>
  )
}

const DIFF_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'title',          label: 'Título' },
  { key: 'description',    label: 'Descripción' },
  { key: 'price',          label: 'Precio' },
  { key: 'price_usd',      label: 'Precio USD' },
  { key: 'price_eur',      label: 'Precio EUR' },
  { key: 'currency',       label: 'Moneda' },
  { key: 'whatsapp_number',label: 'WhatsApp' },
  { key: 'category',       label: 'Categoría' },
  { key: 'tier',           label: 'Tier' },
  { key: 'localidad',      label: 'Localidad' },
  { key: 'attributes',     label: 'Atributos' },
  { key: 'image_urls',     label: 'Fotos' },
  { key: 'video_urls',     label: 'Videos' },
  { key: 'audio_url',      label: 'Audio' },
  { key: 'cover_video_url',label: 'Cover video' },
]

function formatDiffValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) {
    if (v.length === 0) return '—'
    if (typeof v[0] === 'string' && /^https?:\/\//.test(v[0] as string)) {
      return `${v.length} archivo${v.length === 1 ? '' : 's'}`
    }
    return v.join(', ')
  }
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== null && val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0))
      .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(', ') : String(val)}`)
    return entries.length ? entries.join(' · ') : '—'
  }
  const s = String(v)
  return s.length > 240 ? s.slice(0, 240) + '…' : s
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    // Order-sensitive for image_urls (cover slot matters); for
    // multi-select chip fields like servicios the user picks from a
    // finite list so two rows with the same selection usually hit this
    // ordered equality anyway. A sorted-compare would hide reorder-only
    // edits, which aren't meaningful but also aren't "changes" worth
    // flagging.
    return a.every((x, i) => x === b[i])
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  return false
}

function RevisionDiffModal({
  state,
  onClose,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: { revision: any; parent: any | null; loading: boolean }
  onClose: () => void
}) {
  const { revision, parent, loading } = state
  const diffs = !loading && parent
    ? DIFF_FIELDS
        .map(f => ({ ...f, parent: parent[f.key], revision: revision[f.key] }))
        .filter(d => !valuesEqual(d.parent, d.revision))
    : []

  return (
    <div
      className="fixed inset-0 z-[110] bg-[var(--v-bg-base)]/95 backdrop-blur-md flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-[var(--v-bg-elevated)] border border-[rgba(37,99,235,0.2)] rounded-[6px] max-w-[780px] w-full max-h-[80vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-[var(--v-bg-elevated)] border-b border-white/5 px-8 py-5 flex items-center justify-between">
          <p className="text-[9px] font-normal tracking-[.22em] uppercase text-[var(--v-accent)]" style={MONO}>
            Cambios en revisión
          </p>
          <button
            onClick={onClose}
            className="text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] bg-transparent border-0 text-xl leading-none cursor-pointer"
            aria-label="Cerrar"
          >✕</button>
        </div>

        <div className="px-8 py-6">
          {loading && (
            <p className="text-[11px] text-[var(--v-text-tertiary)] py-8 text-center" style={MONO}>
              Cargando post original…
            </p>
          )}
          {!loading && diffs.length === 0 && (
            <p className="text-[11px] text-[var(--v-text-tertiary)] py-8 text-center" style={MONO}>
              No hay diferencias entre la revisión y el post original.
            </p>
          )}
          {!loading && diffs.length > 0 && (
            <div className="flex flex-col gap-5">
              {diffs.map(d => (
                <div key={d.key} className="border border-white/5 rounded-[6px] overflow-hidden">
                  <div className="px-4 py-2 bg-white/[0.02] border-b border-white/5">
                    <p className="text-[9px] font-normal tracking-[.2em] uppercase text-[var(--v-accent)]" style={MONO}>
                      {d.label}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2">
                    <div className="px-4 py-3 border-b md:border-b-0 md:border-r border-white/5">
                      <p className="text-[7px] font-normal tracking-[.24em] uppercase text-[var(--v-text-tertiary)] mb-1" style={MONO}>
                        Antes
                      </p>
                      <p className="text-[13px] text-[rgba(255,255,255,0.55)] leading-relaxed whitespace-pre-wrap break-words">
                        {formatDiffValue(d.parent)}
                      </p>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-[7px] font-normal tracking-[.24em] uppercase text-[var(--v-accent)] mb-1" style={MONO}>
                        Después
                      </p>
                      <p className="text-[13px] text-[var(--v-text-primary)] leading-relaxed whitespace-pre-wrap break-words">
                        {formatDiffValue(d.revision)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
