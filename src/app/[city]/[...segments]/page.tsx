import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { cache } from 'react'
import GeoFeedPage from '@/components/GeoFeedPage'
import PostDetailView from '@/components/post/PostDetailView'
import { resolveGeoPath, deepestFk, getGeoDisplayName } from '@/lib/geo'
import {
  BASE_URL,
  breadcrumbListJsonLd,
  cityFaqJsonLd,
  cityWebPageJsonLd,
  crumbsFromSegments,
  getKeywordAliases,
  hreflangAlternates,
  itemListJsonLd,
  jsonLdString,
  localeForCountry,
  profilePageJsonLd,
} from '@/lib/seo'
import {
  SEO_SLUG_SET,
  findSeoPage,
  fillTemplate,
  type SeoLandingPage,
} from '@/config/seo-landing-pages'
import {
  CATEGORY_PLURAL_SET,
  postCanonicalPath,
} from '@/lib/post-url'

/**
 * Catch-all route. Three URL shapes collapse here:
 *
 *   1. Geo feeds:
 *        /{country}/{provincia}
 *        /{country}/{provincia}/{comuna}
 *        /{country}/{provincia}/{comuna}/{barrio}
 *
 *   2. SEO landing pages (last segment matches a reserved SEO slug — see
 *      src/config/seo-landing-pages.ts):
 *        /{country}/{provincia}/destacados
 *        /{country}/{provincia}/{comuna}/hogar-reparaciones
 *
 *   3. Post detail (new canonical URL — see src/lib/post-url.ts):
 *        /{country}/{provincia}/{category-plural}/{alias}
 *        /{country}/{provincia}/{comuna}/{category-plural}/{alias}
 *      e.g. /argentina/buenos-aires/hogar-reparaciones/electricista-juan
 *           /argentina/capital-federal/palermo/servicios/sofia
 *      Category plurals: hogar-reparaciones, servicios, profesionales.
 *
 * Legacy post URL `/{country}/post/{alias}` lives on its own route and 301s
 * via canonical hint, not via this catch-all.
 */

// ISR — feeds & SEO landings regenerate every 5 minutes. Post detail pages
// are rendered client-side after hydration so the revalidate window just
// affects the SSR shell (metadata + JSON-LD).
export const revalidate = 300

type Params = Promise<{ city: string; segments: string[] }>

/**
 * Special slug — `/argentina/provincias` shows the country feed minus posts
 * in Buenos Aires + Capital Federal (the two metropolitan provincias). Pure
 * country root (`/argentina`) keeps showing everything; gateway pill points
 * here so users opting for "Provincias" specifically don't get drowned in
 * metro listings.
 *
 * Slugs are hardcoded (provincia table seed) — if the metropolitan provincia
 * set changes, update this constant + the comment on the gateway pill.
 */
const PROVINCIAS_OVERVIEW_EXCLUDE = ['buenos-aires', 'capital-federal'] as const

function isProvinciasOverview(urlSlug: string, segs: string[]): boolean {
  return urlSlug === 'argentina' && segs.length === 1 && segs[0] === 'provincias'
}

type UrlKind =
  | { kind: 'seo';  geoSegs: string[]; seo: SeoLandingPage }
  | { kind: 'post'; geoSegs: string[]; categoryPlural: string; alias: string }
  | { kind: 'geo';  geoSegs: string[] }

function classifyUrl(segs: string[]): UrlKind {
  if (segs.length === 0) return { kind: 'geo', geoSegs: [] }

  const last = segs[segs.length - 1]
  if (SEO_SLUG_SET.has(last)) {
    const seo = findSeoPage(last)
    if (seo) return { kind: 'seo', geoSegs: segs.slice(0, -1), seo }
  }

  // Post URL: `<…geo…>/<category-plural>/<alias>`. Requires at least 2
  // segments so the alias doesn't swallow a pure-geo last-segment feed.
  if (segs.length >= 2) {
    const penultimate = segs[segs.length - 2]
    if (CATEGORY_PLURAL_SET.has(penultimate)) {
      return {
        kind: 'post',
        geoSegs: segs.slice(0, -2),
        categoryPlural: penultimate,
        alias: last,
      }
    }
  }

  return { kind: 'geo', geoSegs: segs }
}

// Cached post fetch for metadata + canonical redirect. React's cache()
// dedupes the same-request call between generateMetadata and the page.
type PostSeoRow = {
  id:          string
  title:       string | null
  description: string | null
  image_urls:  string[] | null
  localidad:   string | null
  category:    string | null
  post_slug:   string | null
  status:      string | null
  is_approved: boolean | null
  countries:   { slug?: string | null; name?: string | null } | Array<{ slug?: string | null; name?: string | null }> | null
  provincias:  { slug?: string | null; name?: string | null } | Array<{ slug?: string | null; name?: string | null }> | null
  comunas:     { slug?: string | null; name?: string | null } | Array<{ slug?: string | null; name?: string | null }> | null
}

const fetchPostForCatchAll = cache(async (aliasOrId: string): Promise<PostSeoRow | null> => {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const fields = 'id, title, description, image_urls, localidad, category, post_slug, status, is_approved, countries(slug,name), provincias(slug,name), comunas(slug,name)'
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(aliasOrId)
  if (isUUID) {
    const { data } = await supabase.from('posts').select(fields).eq('id', aliasOrId).maybeSingle<PostSeoRow>()
    return data
  }
  const { data } = await supabase.from('posts').select(fields).eq('post_slug', aliasOrId).maybeSingle<PostSeoRow>()
  return data
})

// Count posts for a geo path so generateMetadata can apply noindex on
// empty feeds. Returns -1 when the geo path itself doesn't resolve (the
// component will call notFound() and serve HTTP 404 — metadata is moot).
const countGeoPostsForCatchAll = cache(async (urlSlug: string, geoSegs: string[]): Promise<number> => {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const geo = await resolveGeoPath(supabase, [urlSlug, ...geoSegs])
  if (!geo) return -1
  const { column, id: fkId } = deepestFk(geo)
  const nowIso = new Date().toISOString()
  const { count } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq(column, fkId)
    .eq('is_approved', true)
    .eq('status', 'published')
    .or('is_hidden.is.null,is_hidden.eq.false')
    .or('is_paused.is.null,is_paused.eq.false')
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
  return count ?? 0
})

/** Build the dynamic OG image URL for a catch-all route shape. Points at
 *  the `/api/og/geo` edge route (sibling-on-catch-all is not allowed by
 *  Next's routing so we can't colocate an `opengraph-image.tsx`). */
function ogImageUrl(city: string, segs: string[]): string {
  const q = new URLSearchParams({ city, segs: segs.join('/') })
  return `${BASE_URL}/api/og/geo?${q.toString()}`
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { city, segments } = await params
  const segs    = segments.map(s => s.toLowerCase())
  const urlSlug = city.toLowerCase()
  const path    = `/${[city, ...segments].join('/')}`
  const locale  = localeForCountry(city)

  // Provincias-overview special case — handled before classifyUrl so the
  // `provincias` literal doesn't fall through to the post-URL fallback
  // (segs.length === 1 → otherwise interpreted as legacy slug → redirect).
  if (isProvinciasOverview(urlSlug, segs)) {
    return {
      title:       'Servicios y profesionales en Provincias de Argentina — Marketplace',
      description: 'Directorio de servicios y profesionales verificados en las provincias de Argentina (Córdoba, Mendoza, Santa Fe, Tucumán, Salta y más). Profesionales verificados en Marketplace.',
      openGraph: {
        title:    'Servicios y profesionales en Provincias de Argentina — Marketplace',
        url:      `${BASE_URL}${path}`,
        siteName: 'Marketplace',
        images:   [{ url: ogImageUrl(city, segs) }],
        type:     'website',
        locale:   locale.ogLocale,
      },
      alternates: {
        canonical: `${BASE_URL}${path}`,
        languages: hreflangAlternates(path),
      },
      robots: { index: true, follow: true },
    }
  }

  const kind = classifyUrl(segs)

  if (kind.kind === 'post') {
    const post = await fetchPostForCatchAll(kind.alias)
    if (!post) {
      return {
        title:   'Publicación no encontrada | Marketplace',
        robots:  { index: false, follow: false },
      }
    }
    const canonicalPath = postCanonicalPath({
      category:   post.category,
      post_slug:  post.post_slug,
      id:         post.id,
      title:      post.title,
      countries:  post.countries,
      provincias: post.provincias,
      comunas:    post.comunas,
    })
    const canonicalUrl = `${BASE_URL}${canonicalPath}`
    const countryArr   = Array.isArray(post.countries) ? post.countries[0] : post.countries
    const geoLabel     = post.localidad || countryArr?.name || 'Marketplace'

    return {
      // Drop ` | Marketplace` — root layout template already appends it.
      title:       `${post.title} — ${geoLabel}`,
      description: post.description?.slice(0, 155) || `Servicio profesional verificado en ${geoLabel}. Marketplace`,
      openGraph: {
        title:       `${post.title} — Marketplace`,
        description: post.description?.slice(0, 155) || undefined,
        url:         canonicalUrl,
        siteName:    'Marketplace',
        images:      [{ url: ogImageUrl(city, segs) }],
        type:        'profile',
        locale:      locale.ogLocale,
      },
      alternates: {
        canonical: canonicalUrl,
        languages: hreflangAlternates(canonicalPath),
      },
      robots: { index: true, follow: true },
    }
  }

  // Best-effort city label for template interpolation without a DB
  // round-trip. Use the deepest geo segment provided by the URL.
  const labelSource = kind.geoSegs[kind.geoSegs.length - 1] ?? city
  const cityLabel   = labelSource.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  // Aliases — only applied to plain geo feeds. SEO landings already have
  // bespoke keyword templates per slug; stuffing more variants there would
  // dilute the focused intent (e.g. "servicios" + "CABA" + "Buenos Aires"
  // crosses into stuffing for a single H1).
  const geoSlugPath  = [city, ...kind.geoSegs].join('/')
  const geoAliases   = kind.kind === 'geo' ? getKeywordAliases(geoSlugPath) : []
  const aliasParens  = geoAliases.length ? ` (${geoAliases.join(', ')})` : ''
  const aliasComma   = geoAliases.length ? `, ${geoAliases.join(', ')}` : ''

  const title = kind.kind === 'seo'
    ? fillTemplate(kind.seo.titleTpl, cityLabel)
    : `Servicios y profesionales en ${cityLabel}${aliasParens}`

  const description = kind.kind === 'seo'
    ? fillTemplate(kind.seo.descriptionTpl, cityLabel)
    : `Servicios y profesionales verificados en ${cityLabel}${aliasComma}. Directorio de anuncios con fotos reales y contacto directo. Profesionales independientes en Marketplace.`

  const postCount = await countGeoPostsForCatchAll(urlSlug, kind.geoSegs)
  const robots = postCount === 0
    ? { index: false, follow: true }
    : { index: true, follow: true }

  return {
    title,
    description,
    openGraph: {
      title:    kind.kind === 'seo' ? title : `Servicios y profesionales en ${cityLabel}${aliasParens} — Marketplace`,
      url:      `${BASE_URL}${path}`,
      siteName: 'Marketplace',
      images:   [{ url: ogImageUrl(city, segs) }],
      type:     'website',
      locale:   locale.ogLocale,
    },
    alternates: {
      canonical: `${BASE_URL}${path}`,
      languages: hreflangAlternates(path),
    },
    robots,
  }
}

export default async function NestedGeoFeedPage({ params }: { params: Params }) {
  const { city, segments } = await params
  const urlSlug = city.toLowerCase()
  const segs    = segments.map(s => s.toLowerCase())

  // Special-case before classifyUrl so the `provincias` literal doesn't
  // hit the 1-segment legacy-post-slug fallback. Renders the country feed
  // with metropolitan provincias filtered out.
  if (isProvinciasOverview(urlSlug, segs)) {
    return renderProvinciasOverview(urlSlug)
  }

  const kind = classifyUrl(segs)

  if (kind.kind === 'post') {
    const post = await fetchPostForCatchAll(kind.alias)
    if (!post) notFound()

    // If the URL's category plural doesn't match the post's category,
    // redirect to the correct canonical URL so duplicate content doesn't
    // rank. Same for geo mismatches — trust what's in the DB.
    const canonicalPath = postCanonicalPath({
      category:   post.category,
      post_slug:  post.post_slug,
      id:         post.id,
      title:      post.title,
      countries:  post.countries,
      provincias: post.provincias,
      comunas:    post.comunas,
    })
    const currentPath = `/${[urlSlug, ...segs].join('/')}`
    if (canonicalPath !== currentPath) {
      permanentRedirect(canonicalPath)
    }

    const canonicalUrl = `${BASE_URL}${canonicalPath}`

    // Breadcrumbs built from the real DB names (not the URL slug
    // prettified), so Google sees "Argentina › Capital Federal ›
    // Palermo › Mujeres › Valentina" instead of URL-cased fallbacks.
    // Position matters: schema.org requires 1-indexed ordered items.
    const countryArrBc = Array.isArray(post.countries) ? post.countries[0] : post.countries
    const provinciaArr = Array.isArray(post.provincias) ? post.provincias[0] : post.provincias
    const comunaArr    = Array.isArray(post.comunas) ? post.comunas[0] : post.comunas
    const profileCrumbs: Array<{ name: string; path: string }> = [
      { name: 'Inicio', path: '/' },
    ]
    if (countryArrBc?.slug) {
      profileCrumbs.push({ name: countryArrBc.name || countryArrBc.slug, path: `/${countryArrBc.slug}` })
    }
    if (countryArrBc?.slug && provinciaArr?.slug) {
      profileCrumbs.push({ name: provinciaArr.name || provinciaArr.slug, path: `/${countryArrBc.slug}/${provinciaArr.slug}` })
    }
    if (countryArrBc?.slug && provinciaArr?.slug && comunaArr?.slug) {
      profileCrumbs.push({ name: comunaArr.name || comunaArr.slug, path: `/${countryArrBc.slug}/${provinciaArr.slug}/${comunaArr.slug}` })
    }
    profileCrumbs.push({ name: post.title || 'Perfil', path: canonicalPath })

    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdString(profilePageJsonLd(post, canonicalUrl)),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdString(breadcrumbListJsonLd(profileCrumbs)),
          }}
        />
        <PostDetailView id={kind.alias} countrySlug={urlSlug} />
      </>
    )
  }

  const geoSegs = kind.geoSegs
  if (geoSegs.length > 3) notFound()

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const geo = await resolveGeoPath(supabase, [urlSlug, ...geoSegs])

  if (!geo) {
    // 1-segment fallback (no SEO slug, no post URL): assume it's a legacy
    // post slug. Permanent redirect so SEO transfers to the canonical.
    if (kind.kind === 'geo' && segs.length === 1) {
      permanentRedirect(`/${urlSlug}/post/${segs[0]}`)
    }
    notFound()
  }

  const { column, id: fkId } = deepestFk(geo)

  const nowIso = new Date().toISOString()
  let query = supabase
    .from('posts')
    .select('*, countries(slug,name), provincias(slug,name), comunas(slug,name), barrios(slug,name)')
    .eq(column, fkId)
    .eq('is_approved', true)
    .eq('status', 'published')
    .or('is_hidden.is.null,is_hidden.eq.false')
    .or('is_paused.is.null,is_paused.eq.false')
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('created_at', { ascending: false })

  if (kind.kind === 'seo') {
    if (kind.seo.tierFilter && kind.seo.tierFilter.length > 0) {
      query = query.in('tier', [...kind.seo.tierFilter])
    }
    if (kind.seo.categoryFilter) {
      query = query.eq('category', kind.seo.categoryFilter)
    }
    if (kind.seo.verifiedFilter === true) {
      query = query.eq('identity_verified', true)
    }
  }

  const { data: posts } = await query

  const cityLabel = getGeoDisplayName(geo)
  const headline  = kind.kind === 'seo'
    ? fillTemplate(kind.seo.headlineTpl, cityLabel)
    : undefined

  // Breadcrumb trail for the geo feed / SEO landing URL. When the last
  // segment is an SEO slug, we append it as a final crumb with the
  // template-filled headline so "Featured · Capital Federal" shows
  // up in SERP breadcrumbs exactly as it does in the H1.
  const feedCrumbSegs = kind.kind === 'seo'
    ? [urlSlug, ...geoSegs, kind.seo.slug]
    : [urlSlug, ...geoSegs]
  const feedCrumbs = crumbsFromSegments(feedCrumbSegs)
  // Replace the last crumb's name with the SEO headline if applicable
  // (avoids "Featured" appearing as the title-cased URL slug).
  if (kind.kind === 'seo' && feedCrumbs.length > 0) {
    feedCrumbs[feedCrumbs.length - 1] = {
      ...feedCrumbs[feedCrumbs.length - 1],
      name: fillTemplate(kind.seo.headlineTpl, cityLabel),
    }
  }

  // Plain geo feeds get the alias subtitle + inline FAQ + matching JSON-LD.
  // SEO landings (tier-filtered views) skip these — their templated H1 +
  // tier-specific copy is the focus, not generic city Q&A.
  const isGeoFeed   = kind.kind === 'geo'
  const geoSlugPath = [urlSlug, ...geoSegs].join('/')
  const aliases     = isGeoFeed ? getKeywordAliases(geoSlugPath) : []
  const pageUrl     = `${BASE_URL}/${geoSlugPath}`

  return (
    <>
      {posts && posts.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdString(itemListJsonLd(posts, urlSlug)),
          }}
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(breadcrumbListJsonLd(feedCrumbs)),
        }}
      />
      {isGeoFeed && (
        <>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: jsonLdString(cityWebPageJsonLd({
                cityName:    cityLabel,
                countryName: geo.country.name,
                url:         pageUrl,
              })),
            }}
          />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: jsonLdString(cityFaqJsonLd(cityLabel)),
            }}
          />
        </>
      )}
      <GeoFeedPage
        posts={posts ?? []}
        geo={geo}
        cityParam={urlSlug}
        headline={headline}
        aliases={aliases}
        showFaq={isGeoFeed}
      />
    </>
  )
}

/**
 * Render `/argentina/provincias` — the country feed minus the two metropolitan
 * provincias (buenos-aires + capital-federal). Mirrors the standard geo-feed
 * branch with two deviations:
 *
 *   1. The provincia exclusion: a separate Supabase query gets the UUIDs of
 *      `PROVINCIAS_OVERVIEW_EXCLUDE` so the main posts query can `.not(...)`
 *      them out by `provincia_id`. Slug-based filtering through the joined
 *      `provincias.slug` field is not available in PostgREST's `.not()` —
 *      hence the two-step.
 *   2. The headline override forces `Servicios y profesionales en Provincias de Argentina`
 *      so the H1 reflects what's actually filtered (otherwise GeoFeedPage
 *      would default to the country name "Argentina").
 *
 * SEO landing aliases + city FAQ are intentionally skipped — the overview is
 * a curated transient feed, not a primary geo target. Keeps the JSON-LD
 * stack minimal.
 */
async function renderProvinciasOverview(urlSlug: string) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const geo = await resolveGeoPath(supabase, [urlSlug])
  if (!geo) notFound()

  // Resolve excluded provincia UUIDs by slug. If both rows are missing
  // (seed regression) we still want the page to render — `.in()` with an
  // empty array would be a query error, so we skip the filter and surface
  // the full country feed instead. Same fail-open philosophy as the rest
  // of the catch-all.
  const { data: excludedRows } = await supabase
    .from('provincias')
    .select('id')
    .eq('country_id', geo.country.id)
    .in('slug', [...PROVINCIAS_OVERVIEW_EXCLUDE])
  const excludedIds = (excludedRows ?? []).map(r => r.id)

  const nowIso = new Date().toISOString()
  let query = supabase
    .from('posts')
    .select('*, countries(slug,name), provincias(slug,name), comunas(slug,name), barrios(slug,name)')
    .eq('country_id', geo.country.id)
    .eq('is_approved', true)
    .eq('status', 'published')
    .or('is_hidden.is.null,is_hidden.eq.false')
    .or('is_paused.is.null,is_paused.eq.false')
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('created_at', { ascending: false })

  if (excludedIds.length > 0) {
    query = query.not('provincia_id', 'in', `(${excludedIds.join(',')})`)
  }

  const { data: posts } = await query

  const headline = `Servicios y profesionales en Provincias de Argentina`
  const feedCrumbs = crumbsFromSegments([urlSlug, 'provincias'])

  return (
    <>
      {posts && posts.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdString(itemListJsonLd(posts, urlSlug)),
          }}
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(breadcrumbListJsonLd(feedCrumbs)),
        }}
      />
      <GeoFeedPage
        posts={posts ?? []}
        geo={geo}
        cityParam={urlSlug}
        headline={headline}
        // Keep the H1 as the long SEO copy ("Servicios en Provincias de
        // Argentina") but render a clean "PROVINCIAS" kicker pill — the
        // long string was overflowing the nav badge on mobile.
        displayLabel="Provincias"
      />
    </>
  )
}
