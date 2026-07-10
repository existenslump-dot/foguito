import { createClient } from '@supabase/supabase-js'
import type { MetadataRoute } from 'next'
import { SEO_LANDING_PAGES } from '@/config/seo-landing-pages'
import { MARKETPLACE } from '@/config/marketplace.config'
import type { TierId } from '@/lib/categories'
import { postCanonicalPath } from '@/lib/post-url'

/**
 * Sitemap for example.com.
 *
 * Strategy — emit only URLs backed by ≥1 published post. The sitemap is
 * regenerated per request, so empty geos/SEO crosses re-enter automatically
 * the moment a matching post arrives — no deploy needed.
 *
 * Gating rules:
 *   country         → always emitted
 *   provincia       → emitted only if has matching posts
 *   comuna          → emitted only if comuna_id appears in posts
 *   barrio          → emitted only if barrio_id appears in posts
 *   SEO × country   → only if matching posts at country level
 *   SEO × provincia → only if matching posts at provincia level
 *   SEO × comuna    → only if matching posts at that comuna
 *   SEO × barrio    → never emitted (granularity beyond search-volume payoff)
 *   posts           → all published posts
 *   blog            → all published blog posts
 *
 * Priority order for Google:
 *   1.0 — gateway
 *   0.9 — country landing
 *   0.85 — top provincia (high-intent keyword target like "servicios buenos aires")
 *   0.8 — provincia / static / SEO landing × country
 *   0.75 — comuna / SEO landing × provincia
 *   0.7 — barrio / SEO landing × comuna / individual post
 *   0.6 — blog post
 */

// Top-search-volume provincia slugs for YOUR market — these are emitted in
// the sitemap even with zero posts (the empty landing renders CTA + FAQ +
// breadcrumbs, enough content to not look thin) and get elevated priority
// (0.85 vs 0.8) when they do have posts. Tune per deployment; leave empty
// for a strictly content-backed sitemap.
const TOP_PROVINCIA_SLUGS: ReadonlySet<string> = new Set([])

// SEO landing slugs (from src/config/seo-landing-pages.ts) force-emitted for
// the top provincias even without posts. Same tuning advice as above.
const TOP_SEO_SLUGS_ALWAYS_IN_SITEMAP: ReadonlySet<string> = new Set([])

// SEO slugs dropped from the sitemap entirely. URLs remain functional for
// internal deep-linking — we just don't ask Google to index them.
const SITEMAP_DEAD_SEO_SLUGS: ReadonlySet<string> = new Set([])

type PostRow = {
  id:           string
  title:        string | null
  post_slug:    string | null
  updated_at:   string
  category:     string | null
  tier:         string | null
  identity_verified: boolean | null
  country_id:   string | null
  provincia_id: string | null
  comuna_id:    string | null
  barrio_id:    string | null
}

type SeoFilter = typeof SEO_LANDING_PAGES[number]

/** True if `post` would match the `seo` landing's tier/category/verified filter. */
function postMatchesSeoFilter(post: PostRow, seo: SeoFilter): boolean {
  if (seo.tierFilter && seo.tierFilter.length > 0) {
    if (!seo.tierFilter.includes(post.tier as TierId)) return false
  }
  if (seo.categoryFilter && post.category !== seo.categoryFilter) return false
  if (seo.verifiedFilter === true && post.identity_verified !== true) return false
  return true
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://example.com').replace(/\/$/, '')

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl,                     lastModified: new Date(), priority: 1.0, changeFrequency: 'daily'   },
    { url: `${baseUrl}/planes`,         lastModified: new Date(), priority: 0.8, changeFrequency: 'weekly'  },
    { url: `${baseUrl}/publicar`,       lastModified: new Date(), priority: 0.8, changeFrequency: 'weekly'  },
    // FAQ standalone — questions/answers mirrored from src/lib/chat-faq.ts.
    { url: `${baseUrl}/faq`,            lastModified: new Date(), priority: 0.6, changeFrequency: 'monthly' },
    // Legal — low priority but indexed (trust signal for Google + compliance).
    { url: `${baseUrl}/terminos`,       lastModified: new Date(), priority: 0.3, changeFrequency: 'yearly' },
    { url: `${baseUrl}/privacidad`,     lastModified: new Date(), priority: 0.3, changeFrequency: 'yearly' },
  ]

  // The dynamic sections need Supabase. Building without env (fresh clone,
  // CI, preview without secrets) must not crash the build — and a transient
  // DB failure must not 500 the live sitemap — so both fall back to the
  // static surface.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.warn('[sitemap] Supabase env missing — emitting static pages only')
    return staticPages
  }
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Fetch geo + posts + blog in one round-trip. Posts must be available
  // before geo loops so we can gate emission by post count.
  const [countriesRes, provinciasRes, comunasRes, barriosRes, postsRes, blogPostsRes] = await Promise.all([
    supabase.from('countries') .select('id, slug, active').eq('active', true),
    supabase.from('provincias').select('id, country_id, slug, active').eq('active', true),
    supabase.from('comunas')   .select('id, provincia_id, slug, active').eq('active', true),
    supabase.from('barrios')   .select('id, comuna_id, slug, active').eq('active', true),
    supabase.from('posts').select('id, title, post_slug, updated_at, category, tier, identity_verified, country_id, provincia_id, comuna_id, barrio_id').eq('status', 'published'),
    // The blog is feature-gated (FEATURE_BLOG). When it ships off, blog_posts
    // may not exist in the schema — skip the query entirely in that case.
    MARKETPLACE.features.blog
      ? supabase.from('blog_posts').select('slug, city, updated_at').eq('published', true)
      : Promise.resolve({ data: [] as Array<{ slug: string; city: string | null; updated_at: string }> }),
  ])

  const countryById = new Map<string, { id: string; slug: string }>()
  for (const c of countriesRes.data ?? []) countryById.set(c.id, c)

  const provinciaById = new Map<string, { id: string; country_id: string; slug: string }>()
  for (const p of provinciasRes.data ?? []) provinciaById.set(p.id, p)

  const comunaById = new Map<string, { id: string; provincia_id: string; slug: string }>()
  for (const c of comunasRes.data ?? []) comunaById.set(c.id, c)

  const provinciaSlugById = new Map<string, string>()
  for (const p of provinciasRes.data ?? []) provinciaSlugById.set(p.id, p.slug)
  const comunaSlugById = new Map<string, string>()
  for (const c of comunasRes.data ?? []) comunaSlugById.set(c.id, c.slug)

  const posts = (postsRes.data ?? []) as PostRow[]

  // Geo IDs that have ≥1 published post — used to gate comuna/barrio
  // emission and SEO landing cartesians. Provincia is gated separately
  // since TOP_PROVINCIA_SLUGS forces emission there.
  const postProvinciaIds = new Set<string>(
    posts.map(p => p.provincia_id).filter((x): x is string => !!x)
  )
  const postComunaIds = new Set<string>(
    posts.map(p => p.comuna_id).filter((x): x is string => !!x)
  )
  const postBarrioIds = new Set<string>(
    posts.map(p => p.barrio_id).filter((x): x is string => !!x)
  )

  /** Walk FKs up the hierarchy to build the URL path prefix (without /post/). */
  function geoPath(
    countryId: string | null | undefined,
    provinciaId: string | null | undefined,
    comunaId: string | null | undefined,
    barrioId: string | null | undefined,
  ): string | null {
    if (barrioId) {
      const b = barriosRes.data?.find(x => x.id === barrioId)
      const c = b && comunaById.get(b.comuna_id)
      const p = c && provinciaById.get(c.provincia_id)
      const co = p && countryById.get(p.country_id)
      if (co && p && c && b) return `/${co.slug}/${p.slug}/${c.slug}/${b.slug}`
    }
    if (comunaId) {
      const c = comunaById.get(comunaId)
      const p = c && provinciaById.get(c.provincia_id)
      const co = p && countryById.get(p.country_id)
      if (co && p && c) return `/${co.slug}/${p.slug}/${c.slug}`
    }
    if (provinciaId) {
      const p = provinciaById.get(provinciaId)
      const co = p && countryById.get(p.country_id)
      if (co && p) return `/${co.slug}/${p.slug}`
    }
    if (countryId) {
      const co = countryById.get(countryId)
      if (co) return `/${co.slug}`
    }
    return null
  }

  /** Count posts at a given geo level that match an SEO landing's filters. */
  function matchingPostsAt(
    geoColumn: 'country_id' | 'provincia_id' | 'comuna_id' | 'barrio_id',
    geoFkId: string,
    seo: SeoFilter,
  ): number {
    let n = 0
    for (const p of posts) {
      if (p[geoColumn] !== geoFkId) continue
      if (postMatchesSeoFilter(p, seo)) n++
    }
    return n
  }

  const geoPages: MetadataRoute.Sitemap = []

  for (const co of countriesRes.data ?? []) {
    geoPages.push({ url: `${baseUrl}/${co.slug}`, lastModified: new Date(), priority: 0.9, changeFrequency: 'daily' })
  }
  for (const p of provinciasRes.data ?? []) {
    const isTop = TOP_PROVINCIA_SLUGS.has(p.slug)
    if (!isTop && !postProvinciaIds.has(p.id)) continue
    const path = geoPath(p.country_id, p.id, null, null)
    if (path) {
      const priority = isTop ? 0.85 : 0.8
      geoPages.push({ url: `${baseUrl}${path}`, lastModified: new Date(), priority, changeFrequency: 'weekly' })
    }
  }
  for (const c of comunasRes.data ?? []) {
    if (!postComunaIds.has(c.id)) continue
    const p = provinciaById.get(c.provincia_id)
    const path = p && geoPath(p.country_id, p.id, c.id, null)
    if (path) geoPages.push({ url: `${baseUrl}${path}`, lastModified: new Date(), priority: 0.75, changeFrequency: 'weekly' })
  }
  for (const b of barriosRes.data ?? []) {
    if (!postBarrioIds.has(b.id)) continue
    const c = comunaById.get(b.comuna_id)
    const p = c && provinciaById.get(c.provincia_id)
    const path = p && c && geoPath(p.country_id, p.id, c.id, b.id)
    if (path) geoPages.push({ url: `${baseUrl}${path}`, lastModified: new Date(), priority: 0.7, changeFrequency: 'weekly' })
  }

  // Drop dead slugs (no public search demand) before any cartesian.
  const liveSeoPages = SEO_LANDING_PAGES.filter(seo => !SITEMAP_DEAD_SEO_SLUGS.has(seo.slug))

  const seoPages: MetadataRoute.Sitemap = []

  for (const co of countriesRes.data ?? []) {
    for (const seo of liveSeoPages) {
      if (matchingPostsAt('country_id', co.id, seo) === 0) continue
      seoPages.push({
        url: `${baseUrl}/${co.slug}/${seo.slug}`,
        lastModified: new Date(),
        priority: 0.8,
        changeFrequency: 'daily',
      })
    }
  }
  for (const p of provinciasRes.data ?? []) {
    const path = geoPath(p.country_id, p.id, null, null)
    if (!path) continue
    const isTopProv = TOP_PROVINCIA_SLUGS.has(p.slug)
    for (const seo of liveSeoPages) {
      const isTopSeo = TOP_SEO_SLUGS_ALWAYS_IN_SITEMAP.has(seo.slug)
      const forceEmit = isTopProv && isTopSeo
      if (!forceEmit && matchingPostsAt('provincia_id', p.id, seo) === 0) continue
      seoPages.push({
        url: `${baseUrl}${path}/${seo.slug}`,
        lastModified: new Date(),
        priority: 0.75,
        changeFrequency: 'daily',
      })
    }
  }
  for (const c of comunasRes.data ?? []) {
    if (!postComunaIds.has(c.id)) continue
    const p = provinciaById.get(c.provincia_id)
    const path = p && geoPath(p.country_id, p.id, c.id, null)
    if (!path) continue
    for (const seo of liveSeoPages) {
      const matches = matchingPostsAt('comuna_id', c.id, seo)
      if (matches === 0) continue
      seoPages.push({
        url: `${baseUrl}${path}/${seo.slug}`,
        lastModified: new Date(),
        priority: 0.7,
        changeFrequency: 'weekly',
      })
    }
  }
  // Barrio-level SEO landings are not emitted — granularity exceeds
  // search-volume payoff and dilutes crawl budget.

  // postCanonicalPath falls back to the legacy /{country}/post/{alias}
  // when the post row doesn't have provincia/category.
  const postPages: MetadataRoute.Sitemap = posts.flatMap((post) => {
    const country = post.country_id && countryById.get(post.country_id)
    if (!country) return []

    const provinciaSlug = post.provincia_id ? provinciaSlugById.get(post.provincia_id) : undefined
    const comunaSlug    = post.comuna_id    ? comunaSlugById.get(post.comuna_id)       : undefined

    const path = postCanonicalPath({
      id:         post.id,
      title:      post.title,
      post_slug:  post.post_slug,
      category:   post.category,
      countries:  { slug: country.slug },
      provincias: provinciaSlug ? { slug: provinciaSlug } : null,
      comunas:    comunaSlug    ? { slug: comunaSlug }    : null,
    })

    return [{
      url: `${baseUrl}${path}`,
      lastModified: new Date(post.updated_at),
      priority: 0.7,
      changeFrequency: 'weekly' as const,
    }]
  })

  // Feature-gated: with FEATURE_BLOG off there are no blog URLs.
  const blogPages: MetadataRoute.Sitemap = MARKETPLACE.features.blog
    ? [
        { url: `${baseUrl}/blog`, lastModified: new Date(), priority: 0.6, changeFrequency: 'weekly' as const },
        ...(blogPostsRes.data ?? []).map((b) => ({
          url: `${baseUrl}/blog/${b.city || MARKETPLACE.blog.citySlugs[0]}/${b.slug}`,
          lastModified: new Date(b.updated_at),
          priority: 0.6,
          changeFrequency: 'monthly' as const,
        })),
      ]
    : []

  return [...staticPages, ...geoPages, ...seoPages, ...postPages, ...blogPages]
}
