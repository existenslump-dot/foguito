import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import GeoFeedPage from '@/components/GeoFeedPage'
import PostDetailView from '@/components/post/PostDetailView'
import { resolveGeoPath, deepestFk, LEGACY_CITY_REDIRECTS } from '@/lib/geo'
import { isReservedSlug } from '@/lib/reserved-slugs'
import {
  BASE_URL,
  COUNTRY_LOCALES,
  cityFaqJsonLd,
  cityWebPageJsonLd,
  getKeywordAliases,
  hreflangAlternates,
  itemListJsonLd,
  jsonLdString,
  localeForCountry,
  DEFAULT_OG_LOCALE,
} from '@/lib/seo'
import { getCloudinaryOgImage } from '@/lib/cloudinary'
import { MARKETPLACE } from '@/config/marketplace.config'

type PostVanityMatch = {
  id:          string
  title:       string | null
  description: string | null
  image_urls:  string[] | null
  localidad:   string | null
  countries:   { slug?: string | null; name?: string | null } | Array<{ slug?: string | null; name?: string | null }> | null
}

async function fetchPostByVanitySlug(
  supabase: ReturnType<typeof createServerClient>,
  slug: string,
): Promise<PostVanityMatch | null> {
  if (isReservedSlug(slug)) return null
  const { data } = await supabase
    .from('posts')
    .select('id, title, description, image_urls, localidad, countries(slug,name)')
    .eq('post_slug', slug)
    .eq('is_approved', true)
    .eq('status', 'published')
    .maybeSingle()
  return data as PostVanityMatch | null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>
}): Promise<Metadata> {
  const { city } = await params
  const urlSlug = city.toLowerCase()

  const isKnownCountry = urlSlug in COUNTRY_LOCALES

  if (!isKnownCountry) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    )
    const post = await fetchPostByVanitySlug(supabase, urlSlug)
    if (post) {
      const countryArr = Array.isArray(post.countries) ? post.countries[0] : post.countries
      const geoLabel = post.localidad || countryArr?.name || 'tu ciudad'
      const canonicalUrl = `${BASE_URL}/${urlSlug}`
      return {
        title: `${post.title} — ${geoLabel}`,
        description: post.description?.slice(0, 155) || `Perfil verificado en ${geoLabel}. Marketplace`,
        openGraph: {
          title: `${post.title} — Marketplace`,
          description: post.description?.slice(0, 155) || undefined,
          url: canonicalUrl,
          siteName: 'Marketplace',
          images: post.image_urls?.[0]
            ? [{ url: getCloudinaryOgImage(post.image_urls[0]), width: 1080, height: 1747 }]
            : [],
          type: 'profile',
          locale: DEFAULT_OG_LOCALE,
        },
        alternates: { canonical: canonicalUrl },
        robots: { index: true, follow: true },
      }
    }
    const geo = await resolveGeoPath(supabase, [urlSlug])
    if (geo) {
      const cityName = geo.country.name
      const feedUrl = `${BASE_URL}/${urlSlug}`
      return {
        title: `Servicios y profesionales en ${cityName}`,
        description: `Servicios y profesionales verificados en ${cityName}. Directorio de anuncios con fotos reales y contacto directo. Profesionales independientes en Marketplace.`,
        openGraph: {
          title: `Servicios y profesionales en ${cityName} — Marketplace`,
          description: `Servicios y profesionales verificados en ${cityName}.`,
          url: feedUrl,
          siteName: 'Marketplace',
          type: 'website',
          locale: DEFAULT_OG_LOCALE,
        },
        alternates: { canonical: feedUrl },
        robots: { index: true, follow: true },
      }
    }

    return { title: 'No encontrado', robots: { index: false, follow: false } }
  }

  const locale = localeForCountry(urlSlug)
  const cityName = locale.name
  const url = `${BASE_URL}/${urlSlug}`

  const aliases     = getKeywordAliases(urlSlug)
  const aliasParens = aliases.length ? ` (${aliases.join(', ')})` : ''
  const aliasComma  = aliases.length ? `, ${aliases.join(', ')}` : ''

  return {
    title: `Servicios y profesionales en ${cityName}${aliasParens}`,
    description: `Servicios y profesionales verificados en ${cityName}${aliasComma}. Directorio de anuncios con fotos reales y contacto directo. Profesionales independientes en Marketplace.`,
    openGraph: {
      title: `Servicios y profesionales en ${cityName}${aliasParens} — Marketplace`,
      description: `Servicios y profesionales verificados en ${cityName}${aliasComma}.`,
      url,
      siteName: 'Marketplace',
      type: 'website',
      locale: locale.ogLocale,
    },
    alternates: {
      canonical: url,
      languages: hreflangAlternates(`/${urlSlug}`),
    },
    robots: { index: true, follow: true },
  }
}

export default async function CityFeedPage({
  params,
}: {
  params: Promise<{ city: string }>
}) {
  const cookieStore = await cookies()
  const rawParams   = await params
  const urlSlug     = rawParams.city.toLowerCase()

  // Optional legacy city→country slug redirects. Empty by default; add real
  // aliases to LEGACY_CITY_REDIRECTS in src/lib/geo.ts and this handler picks
  // them up without any other change.
  if (urlSlug in LEGACY_CITY_REDIRECTS) {
    redirect(`/${LEGACY_CITY_REDIRECTS[urlSlug]}`)
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const geo = await resolveGeoPath(supabase, [urlSlug])

  if (!geo) {
    const post = await fetchPostByVanitySlug(supabase, urlSlug)
    if (post) {
      // Render PostDetailView with the slug as id — it resolves UUID-vs-slug
      // internally. Scope to the default market country slug (multi-country is
      // served from separate deployments).
      return <PostDetailView id={urlSlug} countrySlug={MARKETPLACE.market.defaultCountrySlug} />
    }
    notFound()
  }

  // Aliases + display name for this country-level page. Country = top of
  // the geo hierarchy, so cityName == countryName here.
  const aliases  = getKeywordAliases(urlSlug)
  const cityName = geo.country.name
  const pageUrl  = `${BASE_URL}/${urlSlug}`

  // Filter posts by the deepest resolved FK (country_id at this depth).
  // `.or('..is.null,..eq.false')` keeps legacy rows where is_hidden/is_paused
  // were never set — `.neq(col, true)` drops NULLs in Postgres.
  const { column, id: fkId } = deepestFk(geo)
  const nowIso = new Date().toISOString()
  const { data: posts } = await supabase
    .from('posts')
    .select('*, countries(slug,name), provincias(slug,name), comunas(slug,name), barrios(slug,name)')
    .eq(column, fkId)
    .eq('is_approved', true)
    .eq('status', 'published')
    .or('is_hidden.is.null,is_hidden.eq.false')
    .or('is_paused.is.null,is_paused.eq.false')
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('created_at', { ascending: false })

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
          __html: jsonLdString(cityWebPageJsonLd({ cityName, countryName: cityName, url: pageUrl })),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(cityFaqJsonLd(cityName)),
        }}
      />
      <GeoFeedPage
        posts={posts ?? []}
        geo={geo}
        cityParam={urlSlug}
        aliases={aliases}
        showFaq
      />
    </>
  )
}
