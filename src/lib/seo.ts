/**
 * SEO helpers — hreflang, OpenGraph locale, JSON-LD schemas.
 *
 * Centralizes URL + locale mapping so pages stay short and consistent.
 * Matches the geo schema (countries.slug) — when a new country goes live,
 * add its entry to COUNTRY_LOCALES and expose it in `hreflangAlternates`.
 */

import { getWatermarkedImageUrl } from './cloudinary'
import { MARKETPLACE, COUNTRY_LABEL } from '@/config/marketplace.config'

export const BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL || 'https://example.com'
).replace(/\/$/, '')

// Default market locale, derived from config (server-side; MARKET_* reach here).
// hreflang uses dashes (es-AR); ogLocale/inLanguage use the same tag. If
// MARKET_LOCALE already carries a region ('es-AR') use it verbatim, else qualify
// the language with the default country ('en' + 'US' → 'en-US').
const DEFAULT_SLUG = MARKETPLACE.market.defaultCountrySlug
export const DEFAULT_HREFLANG = MARKETPLACE.market.defaultLocale.includes('-')
  ? MARKETPLACE.market.defaultLocale
  : `${MARKETPLACE.market.defaultLocale}-${MARKETPLACE.market.defaultCountry}`
export const DEFAULT_OG_LOCALE = DEFAULT_HREFLANG.replace('-', '_')

/**
 * Country slug → locale metadata.
 * - `hreflang` uses dashes (es-AR spec)
 * - `ogLocale` uses underscores (Facebook OG spec)
 * - `active` gates hreflang output — inactive locales would 404 crawlers.
 *
 * Seeded from `MARKETPLACE.market` (the default deployment country). When a new
 * country goes live, add its entry here and expose it in `hreflangAlternates`.
 */
export const COUNTRY_LOCALES: Record<string, {
  hreflang: string
  ogLocale: string
  name: string
  active: boolean
}> = {
  [DEFAULT_SLUG]: { hreflang: DEFAULT_HREFLANG, ogLocale: DEFAULT_OG_LOCALE, name: COUNTRY_LABEL, active: true },
}

/** Locale info for a country slug, falling back to the default market. */
export function localeForCountry(slug: string) {
  return COUNTRY_LOCALES[slug.toLowerCase()] ?? COUNTRY_LOCALES[DEFAULT_SLUG]
}

/**
 * `alternates.languages` object for Next.js Metadata. Only emits entries for
 * active countries (inactive → would send crawlers to empty feeds). The
 * x-default points to the same path under AR (the canonical market).
 *
 * @param path  Full URL path *including* country segment (e.g. `/argentina/capital-federal`).
 */
export function hreflangAlternates(path: string): Record<string, string> {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0) return {}

  const [currentCountry, ...rest] = segments
  const current = localeForCountry(currentCountry)
  const subPath = rest.length > 0 ? `/${rest.join('/')}` : ''

  const alternates: Record<string, string> = {
    [current.hreflang]: `${BASE_URL}${normalized}`,
    'x-default':        `${BASE_URL}/${DEFAULT_SLUG}${subPath}`,
  }

  // Parallel URLs under sibling countries — only emit for active ones.
  for (const [slug, meta] of Object.entries(COUNTRY_LOCALES)) {
    if (!meta.active || slug === currentCountry) continue
    alternates[meta.hreflang] = `${BASE_URL}/${slug}${subPath}`
  }

  return alternates
}

// ── JSON-LD schemas ──────────────────────────────────────────────────────

/**
 * Root @graph — combines WebSite + Organization so Google can attach the
 * knowledge-panel brand entity to the site entity via `@id` cross-refs.
 * Emitted once from the root layout; per-page schemas go in their own <script>.
 */
export function rootJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type':       'WebSite',
        '@id':         `${BASE_URL}/#website`,
        url:           BASE_URL,
        name:          'Marketplace',
        description:   'Marketplace · Directorio de servicios y profesionales — encontrá al profesional que necesitás cerca tuyo',
        inLanguage:    DEFAULT_HREFLANG,
        publisher:     { '@id': `${BASE_URL}/#organization` },
      },
      {
        '@type':       'Organization',
        '@id':         `${BASE_URL}/#organization`,
        name:          'Marketplace',
        url:           BASE_URL,
        logo:          `${BASE_URL}/icon`,
        description:   'Directorio de servicios y profesionales — encontrá al profesional que necesitás cerca tuyo.',
        areaServed:    Object.values(COUNTRY_LOCALES)
          .filter(l => l.active)
          .map(l => ({ '@type': 'Country', name: l.name })),
        contactPoint: {
          '@type':            'ContactPoint',
          email:              'contacto@example.com',
          contactType:        'customer support',
          availableLanguage:  ['Spanish'],
        },
      },
    ],
  }
}

/** Legacy single-node Organization schema (kept for any page still importing it). */
export function organizationJsonLd() {
  return {
    '@context':   'https://schema.org',
    '@type':      'Organization',
    '@id':        `${BASE_URL}/#organization`,
    name:         'Marketplace',
    url:          BASE_URL,
    logo:         `${BASE_URL}/icon`,
    description:  'Directorio de servicios y profesionales — encontrá al profesional que necesitás cerca tuyo.',
    areaServed:   Object.values(COUNTRY_LOCALES)
      .filter(l => l.active)
      .map(l => ({ '@type': 'Country', name: l.name })),
  }
}

type FeedItem = {
  id:          string
  title?:      string
  post_slug?:  string | null
  image_urls?: string[] | null
}

/**
 * ItemList schema for a city/provincia/comuna feed. Google consumes this to
 * render "list" rich results and hints the page type for ranking.
 */
export function itemListJsonLd(posts: FeedItem[], countrySlug: string) {
  const base = `${BASE_URL}/${countrySlug}/post`
  return {
    '@context':        'https://schema.org',
    '@type':           'ItemList',
    numberOfItems:     posts.length,
    itemListElement:   posts.map((p, i) => ({
      '@type':   'ListItem',
      position:  i + 1,
      url:       `${base}/${p.post_slug || p.id}`,
      name:      p.title || 'Marketplace profile',
      // Watermark the image indexed by Google Images so it matches what users see.
      ...(p.image_urls?.[0] ? { image: getWatermarkedImageUrl(p.image_urls[0]) } : {}),
    })),
  }
}

type ProfilePost = {
  title?:       string | null
  description?: string | null
  image_urls?:  string[] | null
  localidad?:   string | null
}

/**
 * ProfilePage schema for a post detail. Uses `Person` as mainEntity (matches
 * a profile-centric listing better than Product/Offer); `areaServed` pulls
 * from `localidad` for local SEO signals without needing full LocalBusiness.
 */
export function profilePageJsonLd(post: ProfilePost, url: string) {
  const cleanDesc = (post.description ?? '').slice(0, 500).trim()
  return {
    '@context': 'https://schema.org',
    '@type':    'ProfilePage',
    url,
    mainEntity: {
      '@type':      'Person',
      name:         post.title || 'Marketplace profile',
      url,
      ...(cleanDesc ? { description: cleanDesc } : {}),
      // Watermark the image feeding Google Knowledge Panel + rich snippets.
      ...(post.image_urls?.[0] ? { image: getWatermarkedImageUrl(post.image_urls[0]) } : {}),
      ...(post.localidad ? { address: { '@type': 'PostalAddress', addressLocality: post.localidad } } : {}),
    },
  }
}

/**
 * BreadcrumbList schema — lights up the "site › section › page" row under
 * the blue SERP link and gives Google an explicit hierarchy signal (helps
 * the crawler understand depth without having to infer from the URL).
 *
 * Each crumb is `{ name, path }`; the absolute URL is built internally
 * from BASE_URL. Position is 1-indexed per schema.org spec.
 */
export function breadcrumbListJsonLd(crumbs: Array<{ name: string; path: string }>) {
  return {
    '@context':       'https://schema.org',
    '@type':          'BreadcrumbList',
    itemListElement:  crumbs.map((c, i) => ({
      '@type':    'ListItem',
      position:   i + 1,
      name:       c.name,
      item:       `${BASE_URL}${c.path.startsWith('/') ? c.path : `/${c.path}`}`,
    })),
  }
}

/**
 * Turn a raw URL-segment array into human-readable crumb labels.
 * - Slugs get spaced + title-cased (`capital-federal` → `Capital Federal`).
 * - Known country slugs use their display name from COUNTRY_LOCALES.
 * - Accumulates the path so each crumb points to its own level.
 *
 * Used by feeds + SEO landing pages. Post-detail breadcrumbs are built
 * differently (real DB names, not URL-prettified) so they're not covered here.
 */
export function crumbsFromSegments(segments: string[]): Array<{ name: string; path: string }> {
  const list: Array<{ name: string; path: string }> = [{ name: 'Inicio', path: '/' }]
  let acc = ''
  segments.forEach((seg, i) => {
    acc += `/${seg}`
    const name = i === 0 && COUNTRY_LOCALES[seg]
      ? COUNTRY_LOCALES[seg].name
      : seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    list.push({ name, path: acc })
  })
  return list
}

/** Inline JSON-LD serializer safe for `dangerouslySetInnerHTML`. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

// ── Geo keyword aliases ──────────────────────────────────────────────────

/**
 * Slug-path → array of synonym names for keyword variants. Used in title,
 * meta description, and a subtitle below H1 so high-volume search variants
 * ("servicios caba", "servicios buenos aires") rank against the canonical
 * Capital Federal page without spawning duplicate URLs.
 *
 * Lookup walks up the hierarchy: `argentina/capital-federal/palermo`
 * inherits `argentina/capital-federal` aliases when no direct match exists.
 *
 * Add new entries when one geographic entity goes by multiple names in
 * queries. Heavy SERP overlap between two terms is the best signal.
 */
export const GEO_KEYWORD_ALIASES: Record<string, readonly string[]> = {
  // Capital Federal goes by three names that rank separately in Google:
  // "Capital Federal" (formal/legal), "CABA" (acronym, journalism +
  // colloquial), "Buenos Aires" (the city, technically distinct from the
  // homonymous province). The canonical URL stays /argentina/capital-federal;
  // the aliases ride along in title/meta/H1-subtitle.
  'argentina/capital-federal': ['CABA', 'Buenos Aires'],
}

/**
 * Returns keyword aliases for a slug path, walking up the geo hierarchy.
 * `argentina/capital-federal/palermo` falls through to `capital-federal`'s
 * aliases. Returns `[]` when no level has an entry configured.
 */
export function getKeywordAliases(geoSlugPath: string): readonly string[] {
  const parts = geoSlugPath.split('/').filter(Boolean)
  for (let i = parts.length; i > 0; i--) {
    const key = parts.slice(0, i).join('/')
    const aliases = GEO_KEYWORD_ALIASES[key]
    if (aliases) return aliases
  }
  return []
}

// ── City FAQ ─────────────────────────────────────────────────────────────

export type CityFaqEntry = { q: string; a: string }

/**
 * Single source of truth for the city-level FAQ shown on geo feed pages.
 * Both the visible `<CityFaq>` component and the `FAQPage` JSON-LD consume
 * this — they MUST stay in sync because Google penalizes (or just ignores)
 * FAQ schema whose questions/answers don't match the rendered HTML.
 *
 * Answers are intentionally generic so they remain accurate as inventory
 * shifts — no hard counts, no specific prices, no time-bound claims.
 */
export function cityFaqQuestions(cityName: string): readonly CityFaqEntry[] {
  return [
    {
      q: `¿Cómo encuentro profesionales verificados en ${cityName}?`,
      a: `Cada anuncio en Marketplace puede pasar por verificación de identidad antes de publicarse. Buscá el badge "Verificado" en la lista de ${cityName} para ver solo profesionales con identidad confirmada — la verificación incluye documento + selfie tomados al momento del alta.`,
    },
    {
      q: `¿Los profesionales de ${cityName} son independientes?`,
      a: `Sí. Marketplace es un directorio de profesionales independientes — no somos una agencia y no intermediamos en el contacto. Cada perfil en ${cityName} gestiona sus propios horarios, precios y ubicación; el contacto va directo al teléfono o canal publicado en el perfil.`,
    },
    {
      q: `¿Qué precios tienen los anuncios en ${cityName}?`,
      a: `Los precios los define cada profesional y aparecen en la descripción del anuncio cuando opta por mostrarlos. El directorio incluye desde anuncios independientes hasta los planes Basic, Gold y Elite — el filtro de plan agrupa los anuncios destacados de ${cityName}.`,
    },
    {
      q: `¿Cómo publico un anuncio en ${cityName}?`,
      a: `Creá una cuenta, completá tu perfil y publicá tu anuncio desde el panel. Antes de aparecer en el listado de ${cityName} pasa por verificación de identidad y una revisión de moderación. Una vez aprobado, podés editarlo cuando quieras desde tu panel.`,
    },
    {
      q: `¿Cómo sé que un anuncio de ${cityName} es real y no falso?`,
      a: `Priorizá anuncios con el badge "Verificado": implica chequeo documental + selfie verificada por el equipo de Marketplace. Las fotos del anuncio se capturan en el momento del alta, no son stock. Si algo te parece sospechoso, reportá el anuncio al equipo de moderación desde el listado.`,
    },
    {
      q: `¿Cómo funciona la verificación de identidad?`,
      a: `Al verificarse, cada profesional presenta un documento de identidad y una selfie que el equipo de Marketplace contrasta antes de aprobar el anuncio. El badge "Verificado" indica que ese chequeo se completó. Esto reduce los anuncios falsos y asegura que cada anuncio corresponde a una persona real.`,
    },
    {
      q: `¿Cómo contacto a un profesional de ${cityName}?`,
      a: `Cada perfil publica el canal que prefiere (WhatsApp, Telegram o llamado). Marketplace no intermedia mensajes — escribís directo al profesional. Un primer mensaje útil incluye qué servicio te interesa, día y hora aproximada, ubicación prevista y cualquier consulta sobre precios y disponibilidad. Mensaje claro y conciso; si no contesta de inmediato, esperá la respuesta sin insistir.`,
    },
    {
      q: `¿Qué servicios puedo encontrar?`,
      a: `Depende de cada profesional. Cada perfil de ${cityName} indica las modalidades que ofrece y los precios cuando elige mostrarlos. Los detalles concretos se conversan directamente con el profesional en el primer contacto. Marketplace solo publica los anuncios; el acuerdo es siempre entre vos y el profesional.`,
    },
    {
      q: `¿Hay consejos de seguridad para contratar?`,
      a: `Sí: confirmá que el anuncio tenga el badge "Verificado", acordá todos los detalles por escrito antes de contratar y desconfiá de quien pida pagos por adelantado o por fuera de los medios habituales. Si algo no te cierra, cancelá y reportá el anuncio desde el listado. Tratá a cada profesional con respeto y cortesía.`,
    },
    {
      q: `¿Cómo se maneja el pago?`,
      a: `El pago va siempre directo entre vos y el profesional — Marketplace no procesa ni intermedia cobros entre clientes y anunciantes. Acordá medio y momento del pago antes del servicio para evitar malentendidos. Desconfiá de quien exija señas o transferencias por adelantado a cuentas no verificadas.`,
    },
    {
      q: `¿Cómo reporto un anuncio o pido ayuda?`,
      a: `Desde cualquier listado podés reportar un anuncio al equipo de moderación, que revisa cada denuncia. Marketplace puede verificar la identidad de cada anunciante antes de publicar y retira los anuncios que incumplan los Términos y Condiciones. Para otras consultas, escribí al soporte indicado en el pie de página.`,
    },
  ]
}

/**
 * `FAQPage` JSON-LD for a geo feed. Pair with the visible `<CityFaq>`
 * component — Google's FAQ rich result requires the schema's Q&A pairs
 * to match the rendered HTML word-for-word (or close to it).
 */
export function cityFaqJsonLd(cityName: string) {
  return {
    '@context':    'https://schema.org',
    '@type':       'FAQPage',
    mainEntity:    cityFaqQuestions(cityName).map(({ q, a }) => ({
      '@type':         'Question',
      name:            q,
      acceptedAnswer:  { '@type': 'Answer', text: a },
    })),
  }
}

/**
 * `WebPage` + `Place` schema for a geo feed. Anchors the URL to its
 * geographic entity so Google can associate the page with a Place node.
 *
 * Lighter than `LocalBusiness` (which doesn't fit a marketplace of
 * independent providers — Marketplace isn't itself a local business). The
 * `containedInPlace: Country` reference scopes the Place hierarchically.
 */
export function cityWebPageJsonLd(args: {
  cityName:    string
  countryName: string
  url:         string
  inLanguage?: string
}) {
  const { cityName, countryName, url, inLanguage = DEFAULT_HREFLANG } = args
  return {
    '@context':   'https://schema.org',
    '@type':      'WebPage',
    '@id':        `${url}#webpage`,
    url,
    name:         `Servicios y profesionales en ${cityName}`,
    inLanguage,
    isPartOf:     { '@id': `${BASE_URL}/#website` },
    about: {
      '@type': 'Place',
      name:    cityName,
      ...(cityName !== countryName ? {
        containedInPlace: { '@type': 'Country', name: countryName },
      } : {}),
    },
  }
}
