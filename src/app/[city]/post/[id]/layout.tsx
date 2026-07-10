import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { cache } from 'react'
import {
  BASE_URL,
  COUNTRY_LOCALES,
  hreflangAlternates,
  jsonLdString,
  localeForCountry,
  profilePageJsonLd,
} from '@/lib/seo'
import { postCanonicalPath } from '@/lib/post-url'
import { getCloudinaryOgImage } from '@/lib/cloudinary'

type PostSeo = {
  title:       string | null
  description: string | null
  image_urls:  string[] | null
  localidad:   string | null
  category:    string | null
  post_slug:   string | null
  id?:         string
  countries:   { slug?: string | null; name?: string | null } | Array<{ slug?: string | null; name?: string | null }> | null
  provincias:  { slug?: string | null; name?: string | null } | Array<{ slug?: string | null; name?: string | null }> | null
  comunas:     { slug?: string | null; name?: string | null } | Array<{ slug?: string | null; name?: string | null }> | null
}

/**
 * Cached post fetch — `generateMetadata` and the layout both need the same
 * row; React's `cache()` dedupes the Supabase call within one request.
 *
 * The provincia/comuna joins are what enable the canonical pointing to the
 * new `/{country}/{provincia}/.../{cat}/{alias}` URL. Without them we fall
 * back to the legacy path so nothing 404s.
 *
 * Lookup mirrors PostDetailView (client) to keep SEO and rendering aligned:
 * UUID → direct, slug → country-scoped post_slug → ilike title fallback.
 * Before this, the layout's simpler lookup could 404 a post that the client
 * would still render via the title fallback, which would then produce a 404
 * response for a renderable page.
 */
const fetchPostForSeo = cache(async (id: string, countrySlug?: string): Promise<PostSeo | null> => {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const fields = 'id, title, description, image_urls, localidad, category, post_slug, countries(slug,name), provincias(slug,name), comunas(slug,name)'
  if (isUUID) {
    const { data } = await supabase.from('posts').select(fields).eq('id', id).single<PostSeo>()
    return data
  }
  // Resolve country for slug-scoped lookup — slugs are unique-per-country,
  // so without this a colliding slug across countries would return the
  // wrong post.
  let countryId: string | null = null
  if (countrySlug) {
    const { data: countryRow } = await supabase
      .from('countries').select('id').eq('slug', countrySlug).maybeSingle<{ id: string }>()
    countryId = countryRow?.id ?? null
  }
  const baseQuery = supabase.from('posts').select(fields)
  const scopedQuery = countryId ? baseQuery.eq('country_id', countryId) : baseQuery
  const { data } = await scopedQuery.eq('post_slug', id).maybeSingle<PostSeo>()
  if (data) return data
  // Legacy compat: pre-post_slug URLs matched by title ilike.
  const fallbackBase = supabase.from('posts').select(fields)
  const fallbackScoped = countryId ? fallbackBase.eq('country_id', countryId) : fallbackBase
  const { data: fallback } = await fallbackScoped
    .ilike('title', id.replace(/-/g, ' '))
    .limit(1)
    .maybeSingle<PostSeo>()
  return fallback
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; id: string }>
}): Promise<Metadata> {
  const { city, id } = await params
  const countrySlug = city.toLowerCase()
  const post = await fetchPostForSeo(id, countrySlug)

  // The layout body below also notFound()s in these cases, which replaces
  // metadata with the 404 page's. Returning a noindex here is belt-and-
  // suspenders for any edge where metadata is resolved but the body is
  // short-circuited by cache.
  if (!(countrySlug in COUNTRY_LOCALES) || !post) {
    return { title: 'Marketplace', robots: { index: false, follow: false } }
  }

  // Canonical points to the new URL shape (unless the post lacks provincia,
  // in which case postCanonicalPath returns the legacy path — stable either
  // way).
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
  const locale = localeForCountry(city)
  const countryArr = Array.isArray(post.countries) ? post.countries[0] : post.countries
  const geoLabel = post.localidad || countryArr?.name || 'Marketplace'

  return {
    // Drop the ` | Marketplace` suffix — the root layout's title template
    // (`%s | Marketplace`) appends it, so including it here produced
    // `Electricista — Palermo | Marketplace | Marketplace` in the browser tab.
    title: `${post.title} — ${geoLabel}`,
    description: post.description?.slice(0, 155) || `Anuncio verificado en ${geoLabel}. Marketplace`,
    openGraph: {
      title: `${post.title} — Marketplace`,
      description: post.description?.slice(0, 155) || undefined,
      url: canonicalUrl,
      siteName: 'Marketplace',
      // Portada-only portrait crop with the brand watermark — matches the
      // feed-card look (same `WATERMARK_OPTS`) and lets WhatsApp render a
      // tall preview instead of the previous landscape composite. Golden
      // ratio 1080×1747; width/height hints help scrapers pick orientation.
      images: post.image_urls?.[0]
        ? [{ url: getCloudinaryOgImage(post.image_urls[0]), width: 1080, height: 1747 }]
        : [],
      type: 'profile',
      locale: locale.ogLocale,
    },
    alternates: {
      canonical: canonicalUrl,
      languages: hreflangAlternates(canonicalPath),
    },
    // Keep legacy URL indexable; the canonical hint consolidates signals
    // onto the new URL. A noindex would block Google from following the
    // canonical while the new structure is still being re-crawled.
    robots: { index: true, follow: true },
  }
}

export default async function PostLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ city: string; id: string }>
}) {
  const { city, id } = await params
  const countrySlug = city.toLowerCase()

  // Unknown country slug → 404. Previously fell through to a page rendered
  // with an AR locale fallback and a "Publicación no encontrada" body — a
  // 200 OK for a URL that shouldn't exist.
  if (!(countrySlug in COUNTRY_LOCALES)) notFound()

  const post = await fetchPostForSeo(id, countrySlug)

  // Missing post → proper 404 header so Google/Bing deindex deleted or
  // orphaned profiles instead of holding onto them as thin-content 200s.
  // The client component's own "no encontrada" fallback is retained as a
  // safety net for runtime-rendered paths (e.g. uuid-only lookup mismatches).
  if (!post) notFound()

  const canonicalUrl = `${BASE_URL}${postCanonicalPath({
    category:   post.category,
    post_slug:  post.post_slug,
    id:         post.id,
    title:      post.title,
    countries:  post.countries,
    provincias: post.provincias,
    comunas:    post.comunas,
  })}`

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(profilePageJsonLd(post, canonicalUrl)),
        }}
      />
      {children}
    </>
  )
}
