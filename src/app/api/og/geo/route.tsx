import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { SEO_SLUG_SET, findSeoPage, fillTemplate } from '@/config/seo-landing-pages'
import { CATEGORY_PLURAL_SET } from '@/lib/post-url'
import { getWatermarkedImageUrl } from '@/lib/cloudinary'

/**
 * Why an API route instead of `[city]/[...segments]/opengraph-image.tsx`:
 *   Next.js routing forbids sibling files at a catch-all segment — the
 *   catch-all must be the last part of the URL. So we emit OG URLs from
 *   `generateMetadata.openGraph.images` pointing to this route instead,
 *   keyed by city + segments query params.
 */

export const runtime = 'edge'

const SIZE = { width: 1200, height: 630 }

const TIER_LABEL: Record<string, string> = {
  elite:    'ELITE ✦',
  gold:   'GOLD',
  silver:   'SILVER',
  bronze:   'BRONZE',
  basic: 'BASIC',
}
const TIER_COLOR: Record<string, string> = {
  elite:    '#2563EB',
  gold:   '#2563EB',
  silver:   '#475569',
  bronze:   '#475569',
  basic: '#64748B',
}

function prettifySlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

type PostOgRow = {
  title?:      string | null
  localidad?:  string | null
  tier?:       string | null
  image_urls?: string[] | null
}

async function fetchPostForOg(alias: string): Promise<PostOgRow | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(alias)
  const column = isUUID ? 'id' : 'post_slug'

  try {
    const res = await fetch(
      `${url}/rest/v1/posts?${column}=eq.${encodeURIComponent(alias)}&select=title,localidad,tier,image_urls&limit=1`,
      {
        headers: {
          apikey:        key,
          Authorization: `Bearer ${key}`,
          Accept:        'application/json',
        },
        signal: AbortSignal.timeout(3000),
      },
    )
    if (!res.ok) return null
    const rows = await res.json()
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
  } catch {
    return null
  }
}

function brandCard(headline: string, subtitle: string): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: '#FFFFFF',
          color: '#0F172A',
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: '14px',
          fontSize: '26px', letterSpacing: '.32em',
          color: '#2563EB', fontWeight: 300,
        }}>
          Marketplace
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '40px' }}>
          <div style={{
            display: 'flex', fontSize: '84px', lineHeight: 1.05, fontWeight: 400,
            color: '#0F172A', letterSpacing: '-0.02em', maxWidth: '1000px',
          }}>
            {headline}
          </div>
          <div style={{
            display: 'flex', fontSize: '26px',
            color: 'rgba(37, 99, 235,0.85)',
            fontWeight: 300, letterSpacing: '0.08em',
          }}>
            {subtitle}
          </div>
        </div>

        <div style={{
          display: 'flex', fontSize: '20px',
          color: 'rgba(15,23,42,0.55)',
          fontWeight: 300, letterSpacing: '0.04em',
        }}>
          Servicios verificados · Profesionales independientes
        </div>
      </div>
    ),
    { ...SIZE },
  )
}

function postCard(post: PostOgRow): ImageResponse {
  const title    = post.title     ?? 'Marketplace'
  const location = post.localidad ?? 'tu ciudad'
  const tier     = post.tier      ?? undefined
  const portadaRaw = post.image_urls?.[0] ?? undefined
  const portada    = portadaRaw ? getWatermarkedImageUrl(portadaRaw) : undefined

  const tierLabel = tier ? TIER_LABEL[tier] : null
  const tierColor = tier ? TIER_COLOR[tier] ?? '#2563EB' : '#2563EB'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex',
          background: '#FFFFFF', color: '#0F172A',
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        }}
      >
        {portada && (
          <div style={{
            width: '480px', height: '100%', display: 'flex',
            backgroundImage: `url(${portada})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            boxShadow: 'inset -40px 0 40px -20px rgba(8,8,8,0.6)',
          }} />
        )}

        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '56px 64px 48px',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            fontSize: '22px', letterSpacing: '.28em',
            color: '#2563EB', fontWeight: 300,
          }}>
            Marketplace
          </div>

          <div style={{
            display: 'flex', fontSize: '64px', lineHeight: 1.1,
            fontWeight: 400, color: '#FFFFFF',
            letterSpacing: '-0.01em', marginTop: '24px', maxWidth: '620px',
          }}>
            {title}
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: '18px', marginTop: '28px',
          }}>
            {tierLabel && (
              <div style={{
                display: 'flex',
                fontSize: '16px', letterSpacing: '.24em',
                padding: '8px 16px',
                border: `1px solid ${tierColor}`,
                color: tierColor,
                fontWeight: 400,
              }}>
                {tierLabel}
              </div>
            )}
            <div style={{
              display: 'flex', fontSize: '22px',
              color: 'rgba(255,255,255,0.65)',
              fontWeight: 300,
            }}>
              {location}
            </div>
          </div>
        </div>
      </div>
    ),
    { ...SIZE },
  )
}

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const city    = (searchParams.get('city') ?? '').toLowerCase()
  const segsRaw = searchParams.get('segs') ?? ''
  const segs    = segsRaw.split('/').filter(Boolean).map(s => s.toLowerCase())
  const country = prettifySlug(city || 'argentina')

  if (segs.length >= 2 && CATEGORY_PLURAL_SET.has(segs[segs.length - 2])) {
    const alias = segs[segs.length - 1]
    const post = await fetchPostForOg(alias)
    if (post) return postCard(post)
    return brandCard('Marketplace', country)
  }

  const last = segs[segs.length - 1]
  if (last && SEO_SLUG_SET.has(last)) {
    const seo = findSeoPage(last)
    if (seo) {
      const geoSegs = segs.slice(0, -1)
      const cityLabel = geoSegs.length > 0
        ? prettifySlug(geoSegs[geoSegs.length - 1])
        : country
      return brandCard(
        fillTemplate(seo.headlineTpl, cityLabel),
        `Marketplace · ${country}`,
      )
    }
  }

  const deepest = last ? prettifySlug(last) : country
  return brandCard(deepest, `Marketplace · ${country}`)
}
