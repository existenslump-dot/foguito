'use client'
import { supabase } from '@/lib/supabase/client'
import { supabaseFetch, getUserId, parseSession, readAuthCookieRaw } from '@/lib/supabase/direct'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import MarketplaceLoader from '@/components/MarketplaceLoader'
import DashboardStoriesModal from '@/components/dashboard/DashboardStoriesModal'
import PromoModal from '@/components/dashboard/PromoModal'
import BoostModal from '@/components/dashboard/BoostModal'
import PostsGrid from '@/components/dashboard/PostsGrid'
import DashboardHeroCard from '@/components/dashboard/DashboardHeroCard'
import DashboardQuickActions from '@/components/dashboard/DashboardQuickActions'
import DashboardVipCard from '@/components/dashboard/DashboardVipCard'
import ShareProfileCard from '@/components/dashboard/ShareProfileCard'
import { useMarketplaceDialog } from '@/components/ui/MarketplaceDialog'
import type { Post } from '@/lib/types/post'
import { collectPostAssetUrls } from '@/lib/post-assets'
import { recordAuditClient } from '@/lib/audit-client'
import { kycEnabled } from '@/lib/kyc'
import { PAYMENTS_UI_ENABLED, STORIES_ENABLED } from '@/config/marketplace.config'

function selectPrimaryPost(posts: Post[]): Post | null {
  if (posts.length === 0) return null
  const now = Date.now()
  const isExpired = (p: Post): boolean => {
    const ref = p.expires_at
      || (p.published_at
        ? new Date(p.published_at).getTime() + 30 * 24 * 60 * 60 * 1000
        : null)
    return ref ? new Date(ref).getTime() < now : false
  }
  const score = (p: Post): number => {
    if (p.is_approved && p.status === 'published' && !isExpired(p)) return 100
    if (p.status === 'pending' || p.status === 'revision')          return 80
    if (p.status === 'draft')                                       return 60
    if (p.status === 'rejected')                                    return 40
    if (p.is_approved && p.status === 'published' && isExpired(p))  return 30
    return 10
  }
  return [...posts].sort((a, b) => score(b) - score(a))[0]
}

function SectionTitle({ title, link }: { title: string; link?: { label: string; href: string } }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '12px' }}>
      <h3 style={{
        fontFamily: "'Cormorant Garamond', serif", fontSize: '15px', fontWeight: 500,
        color: 'var(--v-accent)', letterSpacing: '.16em', textTransform: 'uppercase',
      }}>
        {title}
      </h3>
      {link && (
        <Link href={link.href} style={{
          fontFamily: "'Montserrat',sans-serif", fontSize: '10px', fontWeight: 500,
          letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--v-accent)',
          textDecoration: 'none', whiteSpace: 'nowrap',
          border: '1px solid rgba(37, 99, 235,0.30)', borderRadius: '999px',
          padding: '5px 12px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
        }}>
          {link.label}
        </Link>
      )}
    </div>
  )
}

function VerificationBanner({ status }: { status: string | null }) {
  const pending  = status === 'pending'
  const rejected = status === 'rejected'
  const title = pending ? 'Verificación en revisión'
    : rejected ? 'Verificación rechazada'
    : 'Verificá tu identidad'
  const body = pending
    ? 'Tu publicación se mostrará en el feed apenas aprobemos tu verificación de identidad.'
    : rejected
      ? 'Tu verificación fue rechazada. Reintentá para que tu publicación pueda salir al feed.'
      : 'Tu publicación ya está cargada. Verificá tu identidad para que se muestre en el feed público.'
  const cta = pending ? 'Ver estado' : rejected ? 'Reintentar' : 'Verificar identidad'
  return (
    <div style={{
      padding: '16px 18px', borderRadius: '10px',
      border: '1px solid rgba(37, 99, 235,0.3)', background: 'rgba(37, 99, 235,0.05)',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      gap: '14px', flexWrap: 'wrap',
    }}>
      <div style={{ minWidth: 0 }}>
        <p style={{
          fontFamily: "'Cormorant Garamond', serif", fontSize: '17px', fontWeight: 500,
          color: 'var(--v-accent)', lineHeight: 1.2, margin: 0,
        }}>
          {title}
        </p>
        <p style={{
          fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '12px',
          color: 'var(--v-text-tertiary)', lineHeight: 1.5, margin: '4px 0 0',
        }}>
          {body}
        </p>
      </div>
      <Link href="/dashboard/verify" style={{
        flexShrink: 0, padding: '10px 18px', borderRadius: '999px',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
        background: pending ? 'transparent' : 'var(--v-accent)',
        border: pending ? '1px solid rgba(37, 99, 235,0.4)' : '1px solid var(--v-accent)',
        color: pending ? 'var(--v-accent)' : 'var(--v-bg-base)',
        fontFamily: "'Montserrat',sans-serif", fontSize: '10px', fontWeight: 500,
        letterSpacing: '.16em', textTransform: 'uppercase', textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}>
        {cta}
      </Link>
    </div>
  )
}

export default function MyPostsPage() {
  const [posts, setPosts]         = useState<Post[]>([])
  const [userId, setUserId]       = useState<string | null>(null)
  // `isAdmin` is tri-state: null = profile not loaded yet, false/true = known.
  // The body doesn't render until it's known, so the non-admin UI never flashes.
  const [isAdmin, setIsAdmin]     = useState<boolean | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ text: string, type: 'success' | 'error' } | null>(null)
  const [confirmUndoId,  setConfirmUndoId]  = useState<string | null>(null)
  const [storiesModal, setStoriesModal] = useState<{ postId: string; postTitle: string } | null>(null)
  const [promoModalPost, setPromoModalPost] = useState<Post | null>(null)
  const [boostModalPost, setBoostModalPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [pausingId, setPausingId] = useState<string | null>(null)
  const [showAlreadyHasPostBanner, setShowAlreadyHasPostBanner] = useState(false)
  const router = useRouter()
  const dlg = useMarketplaceDialog()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('reason') === 'already_has_post') {
      setShowAlreadyHasPostBanner(true)
      const url = new URL(window.location.href)
      url.searchParams.delete('reason')
      window.history.replaceState({}, '', url.toString())
    }
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchUserData() }, [])

  async function fetchUserData() {
    // Read user id from the auth cookie's JWT claims directly — the SDK's
    // auth.getUser/getSession can hang when the navigator.locks auth-token
    // mutex is contended. Cookie parse is sync + lock-free.
    const cookieUserId = getUserId()
    if (!cookieUserId) { router.push('/ingresar'); return }
    setUserId(cookieUserId)
    const session = parseSession(readAuthCookieRaw()) as unknown as { user?: { email?: string } } | null
    setUserEmail(session?.user?.email ?? null)

    // Single retry on transient errors — a blip would silently degrade the
    // admin UI to non-admin otherwise.
    const profilePath = `profiles?select=full_name,is_admin,verification_status&id=eq.${encodeURIComponent(cookieUserId)}&limit=1`
    type ProfileRow = { full_name: string | null; is_admin: boolean; verification_status: string | null }
    let { data: profileRows, error: profileErr } = await supabaseFetch<ProfileRow[]>(profilePath)
    if (profileErr) {
      await new Promise(r => setTimeout(r, 250))
      const retry = await supabaseFetch<ProfileRow[]>(profilePath)
      profileRows = retry.data
      profileErr = retry.error
    }
    if (profileErr) {
      console.error('[dashboard] profile fetch failed after retry', profileErr)
      setIsAdmin(false)
      setUserName(null)
      setVerificationStatus('approved')
    } else {
      const profile = profileRows?.[0]
      setIsAdmin(!!profile?.is_admin)
      setUserName(profile?.full_name || null)
      setVerificationStatus(profile?.verification_status ?? null)
    }

    const postFields = '*,countries(slug,name),provincias(slug,name),comunas(slug,name),barrios(slug,name)'
    const postPath = `posts?select=${encodeURIComponent(postFields)}&user_id=eq.${encodeURIComponent(cookieUserId)}&order=created_at.desc`
    const { data: postsData, error: postsErr } = await supabaseFetch<Post[]>(postPath)

    if (postsErr) {
      console.error('[dashboard] posts fetch failed', postsErr)
      showNotification(`Error al cargar publicaciones: ${postsErr.message}`, 'error')
    } else if (postsData) {
      setPosts(postsData)
    }
    setConfirmUndoId(null)
    setLoading(false)
  }

  const showNotification = (text: string, type: 'success' | 'error') => {
    setNotification({ text, type })
    setTimeout(() => setNotification(null), 4500)
  }

  async function openDeleteModal(post: Post) {
    if (!userId) return
    const ok = await dlg.confirm('La publicación será eliminada de forma permanente.', {
      title: 'Eliminar publicación',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    })
    if (!ok) return

    // Snapshot Cloudinary URLs before the row disappears — the delete cascade
    // loses the references otherwise and assets stay on Cloudinary forever.
    const target = posts.find(p => p.id === post.id)
    const urls = collectPostAssetUrls(target as Parameters<typeof collectPostAssetUrls>[0])

    const { error } = await supabase.from('posts').delete().eq('id', post.id)
    if (error) {
      showNotification(error.message, 'error')
      return
    }
    void recordAuditClient({
      eventType: 'post_deleted',
      subjectType: 'post',
      subjectId: post.id,
      metadata: {
        deleted_post_title: post.title,
        self_delete: true,
      },
    })
    if (urls.length > 0) {
      fetch('/api/media/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
        keepalive: true,
      }).catch(err => console.error('[dashboard] cleanup failed:', err))
    }
    showNotification('Publicación eliminada correctamente.', 'success')
    fetchUserData()
  }

  async function undoRevision(revisionPostId: string) {
    const { error } = await supabase.from('posts').delete().eq('id', revisionPostId)
    if (error) showNotification('Error al cancelar la solicitud.', 'error')
    else { showNotification('Solicitud de cambio eliminada.', 'success'); fetchUserData() }
    setConfirmUndoId(null)
  }

  async function submitDraft(post: Post) {
    const { error } = await supabase.from('posts').update({ status: 'pending' }).eq('id', post.id)
    if (error) { showNotification('Error al enviar', 'error'); return }
    showNotification('Publicación enviada a revisión', 'success')
    fetchUserData()
  }

  async function togglePause(post: Post) {
    if (!userId) return
    // Guard against double-click: two fast clicks fire two concurrent UPDATEs
    // and the optimistic setPosts ends up out of sync with whichever write won.
    if (pausingId === post.id) return
    setPausingId(post.id)
    try {
      const isPaused = !!post.is_paused
      if (isPaused) {
        // Resuming — extend expires_at by the duration it was paused
        const pausedAt = post.paused_at ? new Date(post.paused_at) : new Date()
        const pausedMs = Date.now() - pausedAt.getTime()
        const currentExpiry = post.expires_at ? new Date(post.expires_at) : new Date()
        const newExpiry = new Date(currentExpiry.getTime() + pausedMs).toISOString()
        const { error } = await supabase.from('posts').update({
          is_paused: false, paused_at: null, expires_at: newExpiry,
        }).eq('id', post.id)
        if (error) { showNotification('Error al reanudar', 'error'); return }
        setPosts(prev => prev.map(p => p.id === post.id ? { ...p, is_paused: false, paused_at: null, expires_at: newExpiry } : p))
        showNotification('Publicación reanudada. Los días restantes continúan.', 'success')
      } else {
        const { error } = await supabase.from('posts').update({
          is_paused: true, paused_at: new Date().toISOString(),
        }).eq('id', post.id)
        if (error) { showNotification('Error al pausar', 'error'); return }
        setPosts(prev => prev.map(p => p.id === post.id ? { ...p, is_paused: true, paused_at: new Date().toISOString() } : p))
        showNotification('Publicación pausada. No se descontarán días del plan.', 'success')
      }
    } finally {
      setPausingId(null)
    }
  }

  // Wait for profile resolution before rendering the body — otherwise the
  // initial pass flashes the non-admin UI while the fetch is in flight.
  if (loading || isAdmin === null) {
    return (
      <div style={{minHeight:'100vh',background:'var(--v-bg-base)',color:'#E0DAD0',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'24px'}}>
        <MarketplaceLoader variant="block" />
      </div>
    )
  }

  const primary = selectPrimaryPost(posts)
  const others = primary ? posts.filter(p => p.id !== primary.id) : []
  const displayName = userName || userEmail || null

  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        .v-fadein{opacity:1} /* concierge mode: no fade-in delay on logged-in pages */
        .d1{animation-delay:.1s}.d2{animation-delay:.25s}.d3{animation-delay:.4s}

        .v-post-card{
          background:rgba(17,17,17,0.7);padding:24px;border-radius:6px;
          border:1px solid rgba(255,255,255,0.04);
          transition:border-color .5s ease;
        }
        .v-post-card:hover{border-color:rgba(255,255,255,0.07)}
        .v-post-card.pending{border-color:rgba(37, 99, 235,0.15)}
        .v-post-card.rejected{border-color:rgba(224,85,85,0.15)}
        .v-post-card.revision{border-color:rgba(37, 99, 235,0.2)}
        .v-post-card.dimmed{opacity:0.5}
        .v-post-card.expired{border-color:rgba(224,85,85,0.1);opacity:.75}

        .v-badge{
          font-family:'Montserrat',sans-serif;font-size:7px;font-weight:400;
          letter-spacing:.2em;text-transform:uppercase;
          height:22px;padding:0 8px;border-radius:6px;border:1px solid;
          display:inline-flex;align-items:center;white-space:nowrap;
        }

        .v-action-btn{
          font-family:'Montserrat',sans-serif;font-size:7px;font-weight:400;
          letter-spacing:.22em;text-transform:uppercase;
          width:100%;height:100%;min-height:36px;padding:0 4px;border-radius:6px;border:1px solid;
          cursor:pointer;text-decoration:none;display:flex;align-items:center;justify-content:center;
          transition:color .4s ease,border-color .4s ease,background .4s ease;
          background:transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          align-self:stretch;box-sizing:border-box;
        }
        .v-action-btn:disabled{cursor:not-allowed;opacity:0.5}
        @media (max-width:639px) {
          .v-action-btn { min-height:40px; font-size:6px !important; letter-spacing:.06em !important; padding:0 2px !important; }
        }

        .v-undo-btn{
          font-family:'Montserrat',sans-serif;font-size:7px;font-weight:400;
          letter-spacing:.18em;text-transform:uppercase;
          padding:8px 16px;border-radius:6px;border:1px solid rgba(255,255,255,0.09);
          cursor:pointer;background:transparent;color:var(--v-text-tertiary);
          transition:color .4s ease,border-color .4s ease;
        }
        .v-undo-btn:hover{color:var(--v-error);border-color:rgba(224,85,85,0.25)}
      `}</style>

      {promoModalPost && (
        <PromoModal
          post={promoModalPost}
          onClose={() => setPromoModalPost(null)}
          onUpdated={(id, patch) => setPosts(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))}
          onNotify={showNotification}
        />
      )}

      {boostModalPost && (
        <BoostModal
          post={boostModalPost}
          onClose={() => setBoostModalPost(null)}
          onUpdated={(id, patch) => setPosts(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))}
          onNotify={showNotification}
        />
      )}

      {dlg.dialog}

      {STORIES_ENABLED && storiesModal && (
        <DashboardStoriesModal
          open={storiesModal}
          userId={userId}
          posts={posts}
          onClose={() => setStoriesModal(null)}
          onNotify={showNotification}
        />
      )}

      <div style={{minHeight:'100vh',background:'var(--v-bg-base)',color:'#E0DAD0',padding:'48px 24px'}}>

        {notification && (
          <div style={{
            position:'fixed',inset:0,zIndex:100,
            display:'flex',justifyContent:'center',alignItems:'center',padding:'0 16px',pointerEvents:'none',
          }}>
            <div
              style={{
                maxWidth:'100%',boxSizing:'border-box',textAlign:'center',
                padding:'14px 28px',borderRadius:'6px',
                border:`1px solid ${notification.type === 'error' ? 'rgba(224,85,85,0.25)' : 'rgba(37, 99, 235,0.25)'}`,
                background: notification.type === 'error' ? 'rgba(40,12,12,0.95)' : 'rgba(20,16,8,0.95)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
                fontFamily:"'Montserrat',sans-serif",fontSize:'9px',fontWeight: 400,
                letterSpacing: '.16em',textTransform:'uppercase',
                color: notification.type === 'error' ? 'var(--v-error)' : 'var(--v-accent)',
              }}
            >
              {notification.text}
            </div>
          </div>
        )}

        <div style={{maxWidth:'900px',margin:'0 auto'}}>

          <div className="v-fadein d2" style={{ marginBottom: '24px' }}>
            {displayName ? (
              <>
                <p style={{
                  fontFamily: "'Montserrat',sans-serif", fontSize: '10px', fontWeight: 500,
                  letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--v-text-tertiary)',
                }}>
                  Buen día,
                </p>
                <h1 style={{
                  fontFamily: "'Cormorant Garamond', serif", fontSize: '26px', fontWeight: 500,
                  color: 'var(--v-text-primary)', lineHeight: 1.1, marginTop: '3px',
                }}>
                  {displayName}
                </h1>
              </>
            ) : (
              <h1 style={{
                fontFamily: "'Cormorant Garamond', serif", fontSize: '26px', fontWeight: 500,
                color: 'var(--v-text-primary)', lineHeight: 1.1,
              }}>
                Bienvenida
              </h1>
            )}
          </div>

          {showAlreadyHasPostBanner && (
            <div
              style={{
                marginBottom:'24px',padding:'14px 18px',borderRadius:'6px',
                border:'1px solid rgba(37, 99, 235,0.3)',
                background:'rgba(37, 99, 235,0.04)',
                display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap',
              }}
            >
              <p style={{
                fontFamily:"'Montserrat',sans-serif",fontSize:'11px',fontWeight:400,
                color:'var(--v-accent)',letterSpacing:'.04em',lineHeight:1.6,margin:0,
              }}>
                Solo podés tener una publicación activa por cuenta. Editá, pausá o eliminá la actual antes de crear otra.
              </p>
              <button
                type="button"
                onClick={() => setShowAlreadyHasPostBanner(false)}
                style={{
                  background:'none',border:'none',cursor:'pointer',color:'var(--v-accent)',
                  fontSize:'18px',padding:'0 4px',lineHeight:1,
                }}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
          )}

          {!primary ? (
            <div
              className="v-fadein d3"
              style={{
                textAlign: 'center',
                padding: '80px 24px',
                border: '1px dashed rgba(255,255,255,0.06)',
                borderRadius: '6px',
              }}
            >
              <p
                style={{
                  fontFamily: "'Montserrat',sans-serif",
                  fontSize: '11px',
                  fontWeight: 400,
                  color: 'var(--v-text-tertiary)',
                  marginBottom: '16px',
                }}
              >
                Aún no tenés publicaciones.
              </p>
              <Link
                href="/dashboard/create"
                style={{
                  display: 'inline-block',
                  padding: '12px 24px',
                  background: 'var(--v-accent)',
                  color: 'var(--v-bg-base)',
                  borderRadius: '6px',
                  fontFamily: "'Montserrat',sans-serif",
                  fontSize: '10px',
                  fontWeight: 500,
                  letterSpacing: '.2em',
                  textTransform: 'uppercase',
                  textDecoration: 'none',
                }}
              >
                Crear mi primera publicación
              </Link>
            </div>
          ) : (
            <div className="v-fadein d3" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {kycEnabled() && !isAdmin && verificationStatus !== 'approved' && (
                <VerificationBanner status={verificationStatus} />
              )}
              {primary.is_hidden && (isAdmin || !kycEnabled() || verificationStatus === 'approved') && (
                <div style={{
                  padding: '16px 18px', borderRadius: '10px',
                  border: '1px solid rgba(37, 99, 235,0.3)', background: 'rgba(37, 99, 235,0.05)',
                }}>
                  <p style={{
                    fontFamily: "'Cormorant Garamond', serif", fontSize: '17px', fontWeight: 500,
                    color: 'var(--v-accent)', lineHeight: 1.2, margin: 0,
                  }}>
                    Publicación oculta del feed
                  </p>
                  <p style={{
                    fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '12px',
                    color: 'var(--v-text-tertiary)', lineHeight: 1.5, margin: '4px 0 0',
                  }}>
                    Tu publicación está cargada pero no se muestra en el feed público en este momento. Escribinos si necesitás ayuda.
                  </p>
                </div>
              )}
              <DashboardHeroCard
                post={primary}
                onRenew={() => router.push(`/publicar?tipo=renovacion&post_id=${primary.id}&tier=${primary.tier ?? ''}`)}
                onSubmitDraft={() => submitDraft(primary)}
                onStories={() => setStoriesModal({ postId: primary.id, postTitle: primary.title ?? '' })}
              />

              {primary.is_approved && primary.status === 'published' && (
                <div>
                  <SectionTitle title="Compartí tu perfil" />
                  <ShareProfileCard
                    post={primary}
                    onCopied={() => showNotification('Link copiado al portapapeles', 'success')}
                  />
                </div>
              )}

              <div>
                <SectionTitle title="Acciones" />
                <DashboardQuickActions
                  post={primary}
                  pausing={pausingId === primary.id}
                  onStories={() => setStoriesModal({ postId: primary.id, postTitle: primary.title ?? '' })}
                  onPromo={() => setPromoModalPost(primary)}
                  onPause={() => togglePause(primary)}
                  onDelete={() => openDeleteModal(primary)}
                />
              </div>

              <div>
                <SectionTitle title="Tu plan" link={PAYMENTS_UI_ENABLED ? { label: 'Ver planes', href: '/planes' } : undefined} />
                <DashboardVipCard post={primary} />
              </div>

              {others.length > 0 && (
                <div style={{ marginTop: '32px' }}>
                  <SectionTitle title="Otras publicaciones" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <PostsGrid
                      posts={others}
                      isAdmin={isAdmin}
                      confirmUndoId={confirmUndoId}
                      pausingId={pausingId}
                      actions={{
                        setConfirmUndoId,
                        undoRevision,
                        submitDraft,
                        openStoriesModal: (post) => setStoriesModal({ postId: post.id, postTitle: post.title ?? '' }),
                        openDeleteModal,
                        openPromoModal: setPromoModalPost,
                        openBoostModal: setBoostModalPost,
                        togglePause,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}


          <footer style={{ marginTop: '80px', paddingTop: '32px', borderTop: '1px solid rgba(37, 99, 235,0.18)' }}>
            <p style={{
              fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
              fontSize: '11px', color: 'rgba(0,0,0,0.55)', lineHeight: 1.7,
              textAlign: 'center', fontWeight: 300,
            }}>
              © 2026 Marketplace <span style={{ color: 'var(--v-accent)' }}>✦</span> · Directorio de servicios y profesionales<br />
              Operamos conforme a la normativa de protección de datos aplicable
            </p>
          </footer>
        </div>
      </div>
    </>
  )
}
