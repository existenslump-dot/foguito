'use client'
import Link from 'next/link'
import Image from 'next/image'
import { TIERS, CATEGORIES, TIER_BADGE_STYLES } from '@/lib/categories'
import { getCloudinaryThumbUrl } from '@/lib/cloudinary'
import type { Post } from '@/lib/types/post'
import { PAYMENTS_UI_ENABLED, RENEWAL_CHECKOUT_ENABLED, DISPLAY_LOCALE } from '@/config/marketplace.config'

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`
}

function daysUntil(iso: string) {
  return Math.floor((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export interface PostsGridActions {
  setConfirmUndoId: (id: string | null) => void
  undoRevision: (postId: string) => void
  submitDraft: (post: Post) => void
  openStoriesModal: (post: Post) => void
  openDeleteModal: (post: Post) => void
  openPromoModal: (post: Post) => void
  openBoostModal: (post: Post) => void
  togglePause: (post: Post) => void
}

interface Props {
  posts: Post[]
  isAdmin: boolean
  confirmUndoId: string | null
  /** Post id currently mid-flight on a pause/resume update; when equal to a
   *  row's id the pause button disables to prevent double-click races. */
  pausingId?: string | null
  actions: PostsGridActions
}

export default function PostsGrid({ posts, isAdmin, confirmUndoId, pausingId, actions }: Props) {
  if (posts.length === 0) {
    return (
      <div
        className="v-fadein d3"
        style={{
          textAlign:'center',padding:'80px 24px',
          border:'1px dashed rgba(255,255,255,0.06)',borderRadius:'6px',
        }}
      >
        <p style={{
          fontFamily:"'Montserrat',sans-serif",fontSize:'11px',fontWeight: 400,
          color:'var(--v-text-tertiary)',marginBottom:'16px',
        }}>
          No tienes anuncios activos.
        </p>
        {isAdmin ? (
          <Link
            href="/admin/create"
            style={{
              fontFamily:"'Montserrat',sans-serif",fontSize:'9px',fontWeight: 400,
              letterSpacing: '.2em',textTransform:'uppercase',color:'var(--v-accent)',
              textDecoration:'none',
            }}
          >
            Publicar mi primer contenido
          </Link>
        ) : (
          <p style={{
            fontFamily:"'Montserrat',sans-serif",fontSize:'9px',fontWeight: 400,
            letterSpacing:'.2em',textTransform:'uppercase',color:'var(--v-text-tertiary)',
          }}>
            Contactanos para crear tu publicación
          </p>
        )}
      </div>
    )
  }

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()

  return (
    <>
      {posts.map((post, idx) => {
        const isRevisionClon  = post.status === 'revision'
        const hasRevisionClon = posts.some(p => p.parent_post_id === post.id)
        const isRejected      = post.status === 'rejected'
        const isDraft         = post.status === 'draft'
        const isPublished     = post.is_approved && post.status === 'published'

        // Concierge-era posts may not have `expires_at` populated. Fall
        // back to `published_at + 30 days`, and if `published_at` is also
        // missing (legacy/manual-create posts where the approval path
        // didn't set it) fall back to `created_at + 30 days`. Together
        // these cover every published row so the expiry badge
        // shows on every card, not just ones approved via /api/admin/
        // approve-post (which is currently the only writer of published_at).
        const referenceDateIso = post.published_at ?? post.created_at
        const effectiveExpiresAt = post.expires_at
          || (referenceDateIso
                ? new Date(new Date(referenceDateIso).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
                : null)
        const expired   = effectiveExpiresAt ? new Date(effectiveExpiresAt).getTime() < now : false
        const daysLeft  = effectiveExpiresAt ? daysUntil(effectiveExpiresAt) : null
        const expiryColor = daysLeft === null ? null
          : daysLeft < 7   ? 'var(--v-error)'
          : daysLeft < 15  ? 'var(--v-accent)'
          : 'var(--v-text-tertiary)'

        let cardClass = 'v-post-card'
        if (isRevisionClon)    cardClass += ' revision'
        else if (isDraft)      cardClass += ' pending'
        else if (isRejected)   cardClass += ' rejected'
        else if (post.status === 'pending') cardClass += ' pending'
        else if (hasRevisionClon) cardClass += ' dimmed'
        else if (expired)      cardClass += ' expired'

        return (
          <div
            key={post.id}
            className={`${cardClass} v-fadein`}
            style={{animationDelay:`${0.3 + idx * 0.08}s`}}
          >
            <div style={{display:'flex',flexDirection:'row',alignItems:'flex-start',gap:'16px',flexWrap:'wrap'}}>

              <div style={{display:'flex',flexDirection:'column',gap:'6px',alignItems:'center',flexShrink:0}}>
                <div style={{
                  position:'relative',
                  width:'110px',height:'110px',background:'var(--v-bg-base)',
                  borderRadius:'6px',overflow:'hidden',
                  border:'1px solid rgba(255,255,255,0.04)',
                  display:'flex',alignItems:'center',justifyContent:'center',
                }}>
                  {post.image_urls && post.image_urls.length > 0 ? (
                    <Image src={getCloudinaryThumbUrl(post.image_urls[0])} alt={post.title ?? 'Marketplace'} fill sizes="(max-width: 768px) 110px, 110px" style={{objectFit:'cover'}} />
                  ) : (
                    <span style={{fontFamily:"'Montserrat',sans-serif",fontSize:'7px',fontWeight: 400,letterSpacing: '.22em',textTransform:'uppercase',color:'var(--v-text-tertiary)',textAlign:'center',padding:'4px'}}>Sin imagen</span>
                  )}
                </div>
                <div style={{width:'110px',textAlign:'center'}}>
                  {isDraft ? (
                    <span className="v-badge" style={{color:'var(--v-accent)',borderColor:'rgba(37, 99, 235,0.25)',background:'rgba(37, 99, 235,0.05)',display:'inline-flex',justifyContent:'center',width:'100%'}}>Borrador</span>
                  ) : isRevisionClon ? (
                    <span className="v-badge" style={{color:'var(--v-accent)',borderColor:'rgba(37, 99, 235,0.25)',background:'rgba(37, 99, 235,0.05)',display:'inline-flex',justifyContent:'center',width:'100%'}}>En revisión</span>
                  ) : expired ? (
                    <span className="v-badge" style={{color:'var(--v-error)',borderColor:'rgba(224,85,85,0.2)',background:'rgba(224,85,85,0.04)',display:'inline-flex',justifyContent:'center',width:'100%'}}>Expirada</span>
                  ) : post.is_approved ? (
                    <span className="v-badge" style={{color:'var(--v-success)',borderColor:'rgba(100,180,100,0.2)',background:'rgba(100,180,100,0.04)',display:'inline-flex',justifyContent:'center',width:'100%'}}>Publicado</span>
                  ) : post.status === 'pending' ? (
                    <span className="v-badge" style={{color:'var(--v-accent)',borderColor:'rgba(37, 99, 235,0.2)',background:'rgba(37, 99, 235,0.04)',display:'inline-flex',justifyContent:'center',width:'100%'}}>Pendiente</span>
                  ) : isRejected ? (
                    <span className="v-badge" style={{color:'var(--v-error)',borderColor:'rgba(224,85,85,0.2)',background:'rgba(224,85,85,0.04)',display:'inline-flex',justifyContent:'center',width:'100%'}}>Rechazado</span>
                  ) : null}
                </div>
              </div>

              <div style={{minWidth:0,flex:1,display:'flex',flexDirection:'column',gap:'12px'}}>
                <div>
                  <h3 style={{
                    fontFamily:"'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
                    fontSize:'22px',fontWeight:400,
                    color:'var(--v-text-primary)',letterSpacing:'-.01em',lineHeight:1.1,marginBottom:'8px',
                  }}>{post.title}</h3>

                  {['silver', 'gold'].includes(post.tier ?? '') && (post.favorites_count || 0) > 0 && (
                    <p style={{fontFamily:"'Montserrat',sans-serif",fontSize:'10px',fontWeight: 400,color:'var(--v-accent)',marginBottom:'4px'}}>
                      ♥ {post.favorites_count} favoritos
                    </p>
                  )}

                  <div style={{display:'flex',flexWrap:'wrap',gap:'8px',alignItems:'center',marginBottom:'8px'}}>
                    <span style={{
                      fontFamily:"'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
                      fontSize:'18px',fontWeight:400,color:'var(--v-accent)',
                    }}>
                      {post.price_usd
                        ? `USD ${Number(post.price_usd).toLocaleString('en-US')}`
                        : `$${Number(post.price || 0).toLocaleString(DISPLAY_LOCALE)}`}
                    </span>
                  </div>

                  <div style={{display:'flex',flexWrap:'wrap',gap:'6px',alignItems:'center',marginBottom:'8px'}}>
                    {post.category && (() => { const cat = CATEGORIES.find(c => c.id === post.category); return cat ? (
                      <span style={{fontFamily:"'Montserrat',sans-serif",fontSize:'7px',fontWeight: 400,letterSpacing: '.2em',textTransform:'uppercase',color:'var(--v-text-secondary)',border:'1px solid rgba(255,255,255,0.09)',padding:'2px 8px',borderRadius:'6px',height:'22px',display:'inline-flex',alignItems:'center'}}>
                        {cat.label}
                      </span>
                    ) : null })()}
                    {post.tier && (() => { const tier = TIERS.find(t => t.id === post.tier); const ts = TIER_BADGE_STYLES[post.tier]; return tier && ts ? (
                      <span style={{fontFamily:"'Montserrat',sans-serif",fontSize:'7px',fontWeight: 400,letterSpacing: '.2em',textTransform:'uppercase',color:ts.color,border:ts.border,background:ts.background,padding:'2px 8px',borderRadius:'6px',height:'22px',display:'inline-flex',alignItems:'center'}}>
                        {tier.label}
                      </span>
                    ) : null })()}
                    {post.localidad && String(post.localidad).split(',').map((part: string) => part.trim()).filter(Boolean).map((part: string) => (
                      <span key={part} style={{fontFamily:"'Montserrat',sans-serif",fontSize:'7px',fontWeight: 400,letterSpacing: '.2em',textTransform:'uppercase',color:'var(--v-text-secondary)',border:'1px solid rgba(255,255,255,0.09)',padding:'2px 8px',borderRadius:'6px',height:'22px',display:'inline-flex',alignItems:'center'}}>
                        {part}
                      </span>
                    ))}
                  </div>

                  {isPublished && (
                    <div style={{display:'flex',flexWrap:'wrap',gap:'16px',marginTop:'4px'}}>
                      {referenceDateIso && (
                        <span style={{fontFamily:"'Montserrat',sans-serif",fontSize:'7px',fontWeight: 400,letterSpacing: '.22em',textTransform:'uppercase',color:'var(--v-text-secondary)'}}>
                          Publicado: {formatDate(referenceDateIso)}
                        </span>
                      )}
                      {daysLeft !== null && !expired && (
                        <span style={{fontFamily:"'Montserrat',sans-serif",fontSize:'7px',fontWeight: 400,letterSpacing: '.22em',textTransform:'uppercase',color: expiryColor ?? 'var(--v-accent)'}}>
                          Vence en {daysLeft} día{daysLeft !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  {isRevisionClon && (
                    confirmUndoId === post.id ? (
                      <div style={{
                        display:'flex',gap:'8px',alignItems:'center',marginBottom:'8px',
                        padding:'8px 12px',borderRadius:'6px',
                        border:'1px solid rgba(224,85,85,0.2)',background:'rgba(224,85,85,0.04)',
                      }}>
                        <span style={{fontFamily:"'Montserrat',sans-serif",fontSize:'7px',fontWeight: 400,letterSpacing: '.22em',textTransform:'uppercase',color:'var(--v-error)',flex:1}}>
                          ¿Eliminar esta solicitud?
                        </span>
                        <button
                          onClick={() => actions.undoRevision(post.id)}
                          style={{fontFamily:"'Montserrat',sans-serif",fontSize:'7px',fontWeight: 400,letterSpacing: '.22em',textTransform:'uppercase',color:'var(--v-error)',background:'transparent',border:'1px solid rgba(224,85,85,0.3)',padding:'5px 12px',borderRadius:'6px',cursor:'pointer'}}
                        >Confirmar</button>
                        <button
                          onClick={() => actions.setConfirmUndoId(null)}
                          style={{fontFamily:"'Montserrat',sans-serif",fontSize:'7px',fontWeight: 400,letterSpacing: '.22em',textTransform:'uppercase',color:'var(--v-text-tertiary)',background:'transparent',border:'1px solid rgba(255,255,255,0.06)',padding:'5px 12px',borderRadius:'6px',cursor:'pointer'}}
                        >Cancelar</button>
                      </div>
                    ) : (
                      <button onClick={() => actions.setConfirmUndoId(post.id)} className="v-undo-btn" style={{marginBottom:'8px',width:'100%'}}>
                        Deshacer solicitud
                      </button>
                    )
                  )}

                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'6px',width:'100%'}}>
                    {isDraft && (
                      <button
                        onClick={() => actions.submitDraft(post)}
                        className="v-action-btn"
                        style={{color:'var(--v-accent)',borderColor:'rgba(37, 99, 235,0.3)',background:'rgba(37, 99, 235,0.06)',justifyContent:'center'}}
                      >
                        Enviar a revisión
                      </button>
                    )}

                    {(isDraft || post.is_approved || isRejected) && !hasRevisionClon && (
                      <Link
                        href={`/dashboard/edit/${post.id}`}
                        className="v-action-btn"
                        style={{...(isRejected ? {color:'var(--v-error)',borderColor:'rgba(224,85,85,0.2)',background:'rgba(224,85,85,0.04)'} : {color:'var(--v-text-tertiary)',borderColor:'rgba(255,255,255,0.06)'}),textAlign:'center',justifyContent:'center',display:'flex',alignItems:'center'}}
                      >
                        {isRejected ? 'Corregir' : 'Editar'}
                      </Link>
                    )}

                    {isPublished && !hasRevisionClon && (
                      <button
                        onClick={() => actions.openStoriesModal(post)}
                        className="v-action-btn"
                        style={{color:'var(--v-text-tertiary)',borderColor:'rgba(255,255,255,0.05)',justifyContent:'center'}}
                        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color='var(--v-accent)'; el.style.borderColor='rgba(37, 99, 235,0.25)' }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color='var(--v-text-tertiary)'; el.style.borderColor='rgba(255,255,255,0.05)' }}
                      >
                        Historias
                      </button>
                    )}

                    {isPublished && !hasRevisionClon && PAYMENTS_UI_ENABLED && (
                      // Payments is a paid add-on: hide the renew CTA when off.
                      <Link
                        // Self-serve mode deep-links into checkout (payment
                        // extends the post automatically); default stays the
                        // concierge form an admin processes manually.
                        href={RENEWAL_CHECKOUT_ENABLED
                          ? `/pagos?renew=${post.id}`
                          : `/publicar?tipo=renovacion&post_id=${post.id}&tier=${post.tier ?? ''}`}
                        className="v-action-btn"
                        style={{color:'var(--v-accent)',borderColor:'rgba(37, 99, 235,0.25)',background:'rgba(37, 99, 235,0.04)',justifyContent:'center',textDecoration:'none',display:'inline-flex',alignItems:'center'}}
                      >
                        Renovar
                      </Link>
                    )}

                    {(isDraft || isRevisionClon || (post.is_approved && !hasRevisionClon) || isRejected || post.status === 'pending') && !isRevisionClon && (
                      <Link
                        href="/dashboard/verify"
                        className="v-action-btn"
                        style={{color:'var(--v-accent)',borderColor:'rgba(37, 99, 235,0.25)',background:'rgba(37, 99, 235,0.04)',justifyContent:'center',textDecoration:'none',display:'inline-flex',alignItems:'center'}}
                      >
                        Verificar
                      </Link>
                    )}

                    {isPublished && (
                      <button
                        onClick={() => actions.openPromoModal(post)}
                        className="v-action-btn"
                        style={{
                          color: post.is_promoted ? 'var(--v-accent)' : 'var(--v-text-tertiary)',
                          borderColor: post.is_promoted ? 'rgba(37, 99, 235,0.4)' : 'rgba(255,255,255,0.06)',
                          background: post.is_promoted ? 'rgba(37, 99, 235,0.06)' : 'transparent',
                          justifyContent:'center',
                        }}
                      >
                        {post.is_promoted ? '★ Promo' : 'Promoción'}
                      </button>
                    )}

                    {/* Boost — paid in credits via /api/posts/boost (the boost
                        columns are server-managed). Payments add-on only:
                        without it the API is inert, so hide the CTA. */}
                    {isPublished && PAYMENTS_UI_ENABLED && (() => {
                      const boostActive = !!post.is_boosted && !!post.boost_ends_at
                        && new Date(post.boost_ends_at).getTime() > Date.now()
                      return (
                        <button
                          onClick={() => actions.openBoostModal(post)}
                          className="v-action-btn"
                          style={{
                            color: boostActive ? 'var(--v-accent)' : 'var(--v-text-tertiary)',
                            borderColor: boostActive ? 'rgba(37, 99, 235,0.4)' : 'rgba(255,255,255,0.06)',
                            background: boostActive ? 'rgba(37, 99, 235,0.06)' : 'transparent',
                            justifyContent:'center',
                          }}
                        >
                          {boostActive ? '⚡ Boost' : 'Boost'}
                        </button>
                      )
                    })()}

                    {(isDraft || isRevisionClon || (post.is_approved && !hasRevisionClon) || isRejected || post.status === 'pending') && !isRevisionClon && (
                      <button
                        onClick={() => actions.openDeleteModal(post)}
                        className="v-action-btn"
                        style={{color:'rgba(224,85,85,0.5)',borderColor:'rgba(224,85,85,0.1)',justifyContent:'center'}}
                        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color='var(--v-error)'; el.style.borderColor='rgba(224,85,85,0.3)' }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color='rgba(224,85,85,0.5)'; el.style.borderColor='rgba(224,85,85,0.1)' }}
                      >
                        Eliminar
                      </button>
                    )}

                    {isPublished && ['silver','gold'].includes(post.tier ?? '') && (
                      <button
                        onClick={() => actions.togglePause(post)}
                        disabled={pausingId === post.id}
                        className="v-action-btn"
                        style={{
                          color: post.is_paused ? 'var(--v-accent)' : 'var(--v-text-tertiary)',
                          borderColor: post.is_paused ? 'rgba(37, 99, 235,0.4)' : 'rgba(255,255,255,0.06)',
                          background: post.is_paused ? 'rgba(37, 99, 235,0.06)' : 'transparent',
                          justifyContent:'center',
                        }}
                      >
                        {pausingId === post.id ? '…' : post.is_paused ? '▶ Reanudar' : '⏸ Pausar'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {isRejected && post.rejection_reason && (
              <div style={{
                marginTop:'16px',padding:'16px',
                background:'rgba(224,85,85,0.04)',
                border:'1px solid rgba(224,85,85,0.12)',borderRadius:'6px',
              }}>
                <p style={{
                  fontFamily:"'Montserrat',sans-serif",fontSize:'7px',fontWeight: 400,
                  letterSpacing: '.2em',textTransform:'uppercase',color:'var(--v-error)',marginBottom:'8px',
                }}>
                  Información de moderación
                </p>
                <p style={{
                  fontFamily:"'Montserrat',sans-serif",fontSize:'11px',fontWeight: 400,
                  color:'#9a9490',lineHeight:1.7,
                }}>
                  &ldquo;{post.rejection_reason}&rdquo;
                </p>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
