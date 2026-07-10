'use client'
import { supabase } from '@/lib/supabase/client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import MarketplaceLoader from '@/components/MarketplaceLoader'

const TIER_RANK: Record<string, number> = { basic: 1, bronze: 2, silver: 3, gold: 4, elite: 5 }

function since(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

function pct(a: number, b: number) {
  if (!b) return '—'
  return (a / b * 100).toFixed(1) + '%'
}

interface PostStat {
  postId: string
  title: string
  tier: string
  views7: number;   views30: number
  favs7: number;    favs30: number
  contact7: number; contact30: number
  photoClicks: { index: number; count: number }[]
}

const METRIC_LEGEND: { label: string; desc: string }[] = [
  { label: 'Vistas',    desc: 'Veces que alguien abrió tu perfil.' },
  { label: 'Favoritos', desc: 'Veces que tocaron el corazón de tu publicación.' },
  { label: 'Contacto',  desc: 'Clics en el botón «Contactar anunciante» (WhatsApp o Telegram).' },
]

function AnalyticsDashboardInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const filterPostId = searchParams.get('post_id')

  const [stats, setStats] = useState<PostStat[]>([])
  const [userTier, setUserTier] = useState<string>('basic')
  const [loading, setLoading] = useState(true)
  const [compStats, setCompStats] = useState<{
    position: number; total: number; avgViews: number; avgFavs: number;
    myViews: number; myFavs: number; city: string;
    tierBreakdown: Record<string, number>;
  } | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/ingresar'); return }

      let query = supabase
        .from('posts')
        .select('id, title, tier')
        .eq('user_id', user.id)
        .eq('status', 'published')
      if (filterPostId) query = query.eq('id', filterPostId)
      const { data: posts } = await query

      if (!posts || posts.length === 0) { setLoading(false); return }

      const highestTier = posts.reduce((best, p) => {
        return (TIER_RANK[p.tier] ?? 0) > (TIER_RANK[best] ?? 0) ? p.tier : best
      }, 'basic')
      setUserTier(highestTier)

      const postIds = posts.map(p => p.id)

      const { data: events } = await supabase
        .from('analytics_events')
        .select('post_id, event_type, photo_index, created_at')
        .in('post_id', postIds)

      const ago7  = since(7)
      const ago30 = since(30)
      const isContact = (t: string) => t === 'whatsapp_click' || t === 'telegram_click'

      const result: PostStat[] = posts.map(post => {
        const ev = (events ?? []).filter(e => e.post_id === post.id)
        const count = (pred: (t: string) => boolean, ago: string) =>
          ev.filter(e => pred(e.event_type) && e.created_at >= ago).length

        const photoCounts: Record<number, number> = {}
        ev.filter(e => e.event_type === 'photo_click' && e.photo_index != null).forEach(e => {
          photoCounts[e.photo_index] = (photoCounts[e.photo_index] ?? 0) + 1
        })
        const photoClicks = Object.entries(photoCounts)
          .map(([idx, c]) => ({ index: Number(idx), count: c }))
          .sort((a, b) => b.count - a.count)

        return {
          postId: post.id, title: post.title, tier: post.tier,
          views7:   count(t => t === 'view', ago7),     views30:   count(t => t === 'view', ago30),
          favs7:    count(t => t === 'favorite', ago7), favs30:    count(t => t === 'favorite', ago30),
          contact7: count(isContact, ago7),             contact30: count(isContact, ago30),
          photoClicks,
        }
      })

      setStats(result)

      if (highestTier === 'gold' && posts.length > 0) {
        const targetPost = posts[0]
        const { data: targetRow } = await supabase
          .from('posts')
          .select('country_id, favorites_count, countries(name)')
          .eq('id', targetPost.id)
          .single<{ country_id: string | null; favorites_count: number | null; countries: { name: string } | null }>()

        if (targetRow?.country_id) {
          const { data: cityPosts } = await supabase
            .from('posts')
            .select('id, tier, favorites_count')
            .eq('country_id', targetRow.country_id)
            .eq('status', 'published')
            .neq('id', targetPost.id)

          if (cityPosts) {
            const myViews = result[0]?.views30 || 0
            const myFavs = targetRow.favorites_count || 0
            const avgFavs = cityPosts.length ? cityPosts.reduce((s, p) => s + (p.favorites_count || 0), 0) / cityPosts.length : 0
            const position = cityPosts.filter(p => (p.favorites_count || 0) > myFavs).length + 1
            const tierBreakdown: Record<string, number> = {}
            cityPosts.forEach(p => { tierBreakdown[p.tier] = (tierBreakdown[p.tier] || 0) + 1 })
            tierBreakdown[targetPost.tier] = (tierBreakdown[targetPost.tier] || 0) + 1

            setCompStats({
              position, total: cityPosts.length + 1,
              avgViews: 0, avgFavs: Math.round(avgFavs),
              myViews, myFavs,
              city: targetRow.countries?.name || '',
              tierBreakdown,
            })
          }
        }
      }

      setLoading(false)
    }
    load()
  }, [router, filterPostId])

  const tierRank = TIER_RANK[userTier] ?? 1
  const showConversion = tierRank >= 3  // silver+
  const showHeatmap    = tierRank >= 3

  return (
    <>
      <style>{`
        @keyframes anFadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:none} }
        .an-fade { opacity:0; animation:anFadeUp .7s cubic-bezier(.22,1,.36,1) forwards; }

        .an-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
        @media(max-width:900px) { .an-grid { grid-template-columns:repeat(2,1fr); } }

        .an-card {
          background:var(--v-bg-elevated);
          border:1px solid rgba(37, 99, 235,0.10);
          border-radius:10px;
          padding:16px 18px;
        }
        .an-card.gold { border-color:rgba(37, 99, 235,0.22); }
        .an-card-lbl {
          font-family:'Montserrat',sans-serif; font-size:9.5px; font-weight:500;
          letter-spacing:.14em; text-transform:uppercase; color:var(--v-text-secondary);
        }
        .an-card-val {
          font-family:'Cormorant Garamond',serif; font-size:32px; font-weight:500;
          color:var(--v-accent); line-height:1; margin-top:8px;
        }

        .an-photo-bar {
          display:flex; align-items:center; gap:10px;
          padding:6px 0; border-bottom:1px solid rgba(37, 99, 235,0.06);
        }
        .an-photo-bar:last-child { border-bottom:none; }
        .an-bar-fill {
          height:4px; border-radius:6px;
          background:linear-gradient(90deg,var(--v-accent),var(--v-accent-light));
          transition:width .6s ease;
        }
      `}</style>

      <main style={{ minHeight: '100vh', background: 'var(--v-bg-base)', color: 'var(--v-text-primary)' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px 80px' }}>

          <div className="an-fade" style={{ animationDelay: '.05s', marginBottom: '32px' }}>
            <p style={{
              fontFamily: "'Montserrat',sans-serif", fontSize: '10px', fontWeight: 500,
              letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--v-text-tertiary)', marginBottom: '8px',
            }}>
              Dashboard · Analytics
            </p>
            <h1 style={{
              fontFamily: "'Cormorant Garamond', serif", fontSize: '30px', fontWeight: 500,
              color: 'var(--v-text-primary)', lineHeight: 1.1, marginBottom: '18px',
            }}>
              Estadísticas
            </h1>
            <div style={{ height: '1px', background: 'linear-gradient(90deg,var(--v-accent),transparent)' }} />
          </div>

          {loading ? (
            <MarketplaceLoader variant="block" />
          ) : stats.length === 0 ? (
            <div className="an-fade" style={{ textAlign: 'center', padding: '80px 24px', border: '1px dashed rgba(37, 99, 235,0.12)', borderRadius: '10px' }}>
              <p style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '11px', fontWeight: 400, color: 'var(--v-text-tertiary)' }}>
                No hay publicaciones publicadas todavía.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '44px' }}>
              {stats.map((s, si) => {
                const cards = [
                  { metric: 'Vistas',    win: '7 días',  value: s.views7,    gold: false },
                  { metric: 'Favoritos', win: '7 días',  value: s.favs7,     gold: false },
                  { metric: 'Contacto',  win: '7 días',  value: s.contact7,  gold: true  },
                  { metric: 'Vistas',    win: '30 días', value: s.views30,   gold: false },
                  { metric: 'Favoritos', win: '30 días', value: s.favs30,    gold: false },
                  { metric: 'Contacto',  win: '30 días', value: s.contact30, gold: true  },
                ]
                return (
                  <div key={s.postId} className="an-fade" style={{ animationDelay: `${0.1 + si * 0.07}s` }}>

                    <div style={{ marginBottom: '18px' }}>
                      <p style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '9px', fontWeight: 500, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--v-text-tertiary)', marginBottom: '6px' }}>
                        Publicación
                      </p>
                      <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '24px', fontWeight: 500, color: 'var(--v-text-primary)', lineHeight: 1 }}>
                        {s.title}
                      </p>
                    </div>

                    <div className="an-grid" style={{ marginBottom: '14px' }}>
                      {cards.map(c => (
                        <div key={`${c.metric}-${c.win}`} className={`an-card${c.gold ? ' gold' : ''}`}>
                          <p className="an-card-lbl">{c.metric} · {c.win}</p>
                          <p className="an-card-val">{c.value.toLocaleString('es-AR')}</p>
                        </div>
                      ))}
                    </div>

                    <div style={{
                      background: 'var(--v-bg-card)', border: '1px solid rgba(37, 99, 235,0.08)',
                      borderRadius: '10px', padding: '14px 16px',
                      display: 'flex', flexDirection: 'column', gap: '8px',
                    }}>
                      {METRIC_LEGEND.map(m => (
                        <div key={m.label} style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                          <span style={{
                            fontFamily: "'Montserrat',sans-serif", fontSize: '9.5px', fontWeight: 600,
                            letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--v-accent)',
                            flexShrink: 0, minWidth: '74px',
                          }}>
                            {m.label}
                          </span>
                          <span style={{
                            fontFamily: "'Montserrat',sans-serif", fontSize: '11.5px', fontWeight: 400,
                            color: 'var(--v-text-secondary)', lineHeight: 1.5,
                          }}>
                            {m.desc}
                          </span>
                        </div>
                      ))}
                    </div>

                    {showConversion && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '14px' }}>
                        {[
                          { win: '7 días',  val: pct(s.contact7, s.views7) },
                          { win: '30 días', val: pct(s.contact30, s.views30) },
                        ].map(c => (
                          <div key={c.win} className="an-card">
                            <p className="an-card-lbl">Conversión · {c.win}</p>
                            <p className="an-card-val">{c.val}</p>
                            <p style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '10.5px', fontWeight: 400, color: 'var(--v-text-tertiary)', marginTop: '6px' }}>
                              Contactos sobre vistas
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {showHeatmap && s.photoClicks.length > 0 && (
                      <div style={{ background: 'var(--v-bg-elevated)', border: '1px solid rgba(37, 99, 235,0.08)', borderRadius: '10px', padding: '16px 18px', marginTop: '14px' }}>
                        <p style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '9px', fontWeight: 500, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--v-accent)', marginBottom: '14px' }}>
                          Fotos más vistas
                        </p>
                        {s.photoClicks.slice(0, 6).map(p => {
                          const maxCount = s.photoClicks[0]?.count ?? 1
                          const barWidth = Math.round((p.count / maxCount) * 100)
                          return (
                            <div key={p.index} className="an-photo-bar">
                              <p style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '12px', fontWeight: 400, letterSpacing: '.04em', color: 'var(--v-text-secondary)', width: '58px', flexShrink: 0 }}>
                                Foto {p.index + 1}
                              </p>
                              <div style={{ flex: 1, background: 'rgba(37, 99, 235,0.08)', borderRadius: '6px', height: '4px' }}>
                                <div className="an-bar-fill" style={{ width: `${barWidth}%` }} />
                              </div>
                              <p style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '12px', fontWeight: 600, color: 'var(--v-accent)', width: '32px', textAlign: 'right', flexShrink: 0 }}>
                                {p.count}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {!showConversion && (
                      <p style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '10px', fontWeight: 400, letterSpacing: '.04em', color: 'var(--v-text-tertiary)', marginTop: '12px' }}>
                        Tasa de conversión y mapa de calor de fotos disponibles en tier Silver o superior.
                      </p>
                    )}

                    {si < stats.length - 1 && (
                      <div style={{ height: '1px', background: 'rgba(37, 99, 235,0.06)', marginTop: '36px' }} />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {compStats && userTier === 'gold' && (
            <div style={{ marginTop: '44px', paddingTop: '32px', borderTop: '1px solid rgba(37, 99, 235,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <span style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '8px', fontWeight: 500, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--v-accent)', border: '1px solid rgba(37, 99, 235,0.3)', padding: '4px 9px', borderRadius: '999px' }}>
                  Exclusivo Gold
                </span>
                <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '20px', fontWeight: 500, color: 'var(--v-accent)' }}>
                  Estadísticas de competencia
                </h3>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                <div className="an-card" style={{ textAlign: 'center' }}>
                  <p className="an-card-lbl">Posición en {compStats.city}</p>
                  <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '32px', fontWeight: 500, color: 'var(--v-text-primary)', lineHeight: 1, marginTop: '8px' }}>
                    #{compStats.position}
                  </p>
                  <p style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '10px', fontWeight: 400, color: 'var(--v-text-tertiary)', marginTop: '6px' }}>
                    de {compStats.total} publicaciones
                  </p>
                </div>
                <div className="an-card" style={{ textAlign: 'center' }}>
                  <p className="an-card-lbl">vs Promedio · Favoritos</p>
                  <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '30px', fontWeight: 500, lineHeight: 1, marginTop: '8px', color: compStats.myFavs >= compStats.avgFavs ? 'var(--v-success)' : 'var(--v-error)' }}>
                    {compStats.avgFavs > 0 ? (compStats.myFavs >= compStats.avgFavs ? '+' : '') + Math.round((compStats.myFavs - compStats.avgFavs) / Math.max(compStats.avgFavs, 1) * 100) + '%' : '—'}
                  </p>
                  <p style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '10px', fontWeight: 400, color: 'var(--v-text-tertiary)', marginTop: '6px' }}>
                    Tú: {compStats.myFavs} · Promedio: {compStats.avgFavs}
                  </p>
                </div>
                <div className="an-card" style={{ textAlign: 'center' }}>
                  <p className="an-card-lbl">Publicaciones en tu ciudad</p>
                  <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '32px', fontWeight: 500, color: 'var(--v-text-primary)', lineHeight: 1, marginTop: '8px' }}>
                    {compStats.total}
                  </p>
                  <p style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '10px', fontWeight: 400, color: 'var(--v-text-tertiary)', marginTop: '6px' }}>
                    {Object.entries(compStats.tierBreakdown).map(([t, c]) => `${t}: ${c}`).join(' · ')}
                  </p>
                </div>
              </div>
            </div>
          )}

          <footer style={{ marginTop: '64px', paddingTop: '32px', borderTop: '1px solid rgba(37, 99, 235,0.18)' }}>
            <p style={{
              fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
              fontSize: '11px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.7,
              textAlign: 'center', fontWeight: 300,
            }}>
              © 2026 Marketplace <span style={{ color: 'var(--v-accent)' }}>✦</span> · Directorio de servicios y profesionales<br />
              Operamos conforme a la normativa de protección de datos aplicable
            </p>
          </footer>
        </div>
      </main>
    </>
  )
}

export default function AnalyticsDashboard() {
  return (
    <Suspense>
      <AnalyticsDashboardInner />
    </Suspense>
  )
}
