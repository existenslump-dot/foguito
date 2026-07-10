import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { TIER_BADGE_STYLES } from '@/lib/categories'
import { postCanonicalPath } from '@/lib/post-url'
import { getCloudinaryUrl, getWatermarkedImageUrl } from '@/lib/cloudinary'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  return {
    title: `${slug} — Perfil | Marketplace`,
    robots: { index: true, follow: true },
  }
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name) { return cookieStore.get(name)?.value } } }
  )

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, profile_bio, identity_verified, profile_public')
    .eq('profile_slug', slug)
    .eq('profile_public', true)
    .single()

  if (!profile) notFound()

  const { data: posts } = await supabase
    .from('posts')
    .select('id, title, tier, category, post_slug, image_urls, price, currency, identity_verified, localidad, countries(slug,name), provincias(slug,name), comunas(slug,name)')
    .eq('user_id', profile.id)
    .eq('status', 'published')
    .eq('is_approved', true)
    .order('created_at', { ascending: false })

  const avatarRaw = posts?.[0]?.image_urls?.[0] || null
  const avatar    = avatarRaw ? getWatermarkedImageUrl(avatarRaw) : null
  const cities = [...new Set(
    (posts || [])
      .map(p => {
        const c = p.countries as { name?: string } | { name?: string }[] | null | undefined
        const countryName = Array.isArray(c) ? c[0]?.name : c?.name
        return p.localidad || countryName
      })
      .filter(Boolean)
  )]
  const highestTier = (posts || []).reduce((best, p) => {
    const rank: Record<string, number> = { gold: 1, silver: 2, bronze: 3, basic: 4 }
    return (rank[p.tier] || 99) < (rank[best] || 99) ? p.tier : best
  }, 'basic')

  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        .pf-fade{opacity:0;animation:fadeUp .8s cubic-bezier(.22,1,.36,1) forwards}
        .pf-card{
          border-radius:3px;overflow:hidden;
          border:1px solid rgba(37, 99, 235,0.08);
          background:rgba(255,255,255,0.015);
          transition:border-color .4s ease;
        }
        .pf-card:hover{border-color:rgba(37, 99, 235,0.28)}
      `}</style>

      <main style={{ minHeight: '100vh', background: 'var(--v-bg-base)', color: '#FFFFFF' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px' }}>

          <Link href="/" className="pf-fade" style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '40px', height: '40px', borderRadius: '50%',
            background: 'var(--v-bg-base)', border: '1px solid var(--v-accent)',
            marginBottom: '32px', textDecoration: 'none',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8L10 13" stroke="var(--v-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>

          <div className="pf-fade" style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '32px', animationDelay: '.1s' }}>
            <div style={{
              width: '80px', height: '80px', borderRadius: '50%', flexShrink: 0,
              border: '2px solid rgba(37, 99, 235,0.5)', overflow: 'hidden',
              background: 'var(--v-bg-card)',
            }}>
              {avatar ? (
                <Image src={avatar} alt={profile.full_name || ''} width={80} height={80} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)', fontSize: '24px' }}>
                  ✦
                </div>
              )}
            </div>

            <div>
              <h1 style={{
                fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
                fontSize: 'clamp(24px, 4vw, 28px)', fontWeight:400,
                color: '#FFFFFF', marginBottom: '6px',
              }}>
                {profile.full_name || slug}
              </h1>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {cities.map(c => (
                  <span key={c} style={{
                    fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '7px', fontWeight: 400,
                    letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)',
                    border: '1px solid rgba(37, 99, 235,0.1)', padding: '3px 8px', borderRadius: '2px',
                  }}>
                    {c}
                  </span>
                ))}

                {highestTier && (
                  <span style={{
                    fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '7px', fontWeight: 400,
                    letterSpacing: '.18em', textTransform: 'uppercase',
                    padding: '3px 8px', borderRadius: '2px',
                    ...(TIER_BADGE_STYLES[highestTier] || {}),
                  }}>
                    {highestTier}
                  </span>
                )}

                {profile.identity_verified && (
                  <span style={{
                    fontSize: '7px', color: 'var(--v-success)',
                    border: '1px solid rgba(106,176,106,0.35)',
                    padding: '3px 8px', borderRadius: '2px',
                    fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontWeight: 400, letterSpacing: '.1em',
                  }}>
                    ✓ ID VERIFICADA
                  </span>
                )}
              </div>
            </div>
          </div>

          {profile.profile_bio && (
            <p className="pf-fade" style={{
              fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '12px', fontWeight: 400,
              color: 'rgba(255,255,255,0.6)', lineHeight: 1.7, marginBottom: '32px', animationDelay: '.2s',
            }}>
              {profile.profile_bio}
            </p>
          )}

          <div className="pf-fade" style={{
            height: '1px', marginBottom: '32px', animationDelay: '.25s',
            background: 'linear-gradient(90deg, transparent, rgba(37, 99, 235,0.3) 40%, rgba(37,99,235,0.4) 50%, rgba(37, 99, 235,0.3) 60%, transparent)',
          }} />

          {!posts?.length ? (
            <p className="pf-fade" style={{
              fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '11px', fontWeight: 400,
              color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: '48px',
              animationDelay: '.3s',
            }}>
              Sin anuncios publicados.
            </p>
          ) : (
            <div className="pf-fade" style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '12px', animationDelay: '.3s',
            }}>
              {posts.map(post => {
                const coverRaw = post.image_urls?.[0]
                const cover    = coverRaw ? getCloudinaryUrl(coverRaw, post.tier ?? 'basic') : null
                const sym = post.currency === 'BRL' ? 'R$' : post.currency === 'EUR' ? '€' : '$'
                return (
                  <Link key={post.id} href={postCanonicalPath(post)} className="pf-card" style={{ textDecoration: 'none' }}>
                    <div style={{ aspectRatio: '3/4', background: 'var(--v-bg-card)', position: 'relative' }}>
                      {cover ? (
                        <Image src={cover} alt={post.title ?? 'Marketplace'} fill sizes="(max-width: 768px) 50vw, 200px" style={{ objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}>✦</div>
                      )}
                      {post.tier && (
                        <span style={{
                          position: 'absolute', top: '6px', right: '6px',
                          fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '6px', fontWeight: 400,
                          letterSpacing: '.22em', textTransform: 'uppercase',
                          padding: '2px 6px', borderRadius: '2px',
                          ...(TIER_BADGE_STYLES[post.tier] || {}),
                        }}>
                          {post.tier}
                        </span>
                      )}
                    </div>
                    <div style={{ padding: '10px 12px' }}>
                      <p style={{
                        fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
                        fontSize: '15px', fontWeight:400,
                        color: '#FFFFFF', marginBottom: '4px',
                      }}>
                        {post.title}
                      </p>
                      <p style={{
                        fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
                        fontSize: '14px', fontWeight:400, color: 'var(--v-accent)',
                      }}>
                        {sym}{post.price?.toLocaleString()}
                      </p>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}

          <footer style={{ marginTop: '64px', textAlign: 'center' }}>
            <p style={{
              fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '7px', fontWeight: 400,
              letterSpacing: '.24em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)',
            }}>
              Marketplace · Servicios y profesionales
            </p>
          </footer>
        </div>
      </main>
    </>
  )
}
