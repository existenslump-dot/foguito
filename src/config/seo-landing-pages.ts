import type { TierId } from '@/lib/categories'

/**
 * SEO landing pages — keyword-rich filtered views layered on top of the
 * geo catch-all route. Pattern: `/{country}/{provincia?}/{comuna?}/{barrio?}/{seoSlug}`.
 *
 * Each entry drives:
 *   - metadata title/description (with `{city}` interpolated from the geo level)
 *   - the H1/kicker shown on the page (via GeoFeedPage's `headline` prop)
 *   - the post query filter (tier subset, category, verified, or combinations)
 *   - the sitemap cross-product (each seo slug × each geo level)
 *
 * Visibility: a seo slug is always rendered, even if its tierFilter has no
 * currently-active tiers. That keeps the URL live for re-activation later —
 * if it hits zero posts it falls back to the empty state.
 *
 * EXAMPLE entries below — replace with the keyword targets for your vertical
 * and market. Each becomes an indexable landing page × every geo level.
 */
export type SeoLandingPage = {
  slug:           string
  titleTpl:       string                 // `{city}` placeholder
  descriptionTpl: string                 // `{city}` placeholder
  headlineTpl:    string                 // `{city}` placeholder — on-page H1/kicker
  /** Null = include all active tiers. Otherwise restrict to this subset. */
  tierFilter:     readonly TierId[] | null
  /** Null = include all categories. Otherwise restrict to this category slug. */
  categoryFilter: string | null
  /** True = restrict to posts with `identity_verified=true`. Null/false = no filter. */
  verifiedFilter: boolean | null
}

export const SEO_LANDING_PAGES: readonly SeoLandingPage[] = [
  {
    slug:           'featured',
    titleTpl:       'Featured listings in {city}',
    descriptionTpl: 'Top featured listings in {city}. Browse verified profiles.',
    headlineTpl:    'Featured · {city}',
    tierFilter:     ['elite', 'gold', 'silver'],
    categoryFilter: null,
    verifiedFilter: null,
  },
  {
    slug:           'verified',
    titleTpl:       'Verified listings in {city}',
    descriptionTpl: 'Verified listings in {city} — identity confirmed.',
    headlineTpl:    'Verified · {city}',
    tierFilter:     null,
    categoryFilter: null,
    verifiedFilter: true,
  },
  {
    slug:           'hogar-reparaciones',
    titleTpl:       'Hogar y reparaciones en {city}',
    descriptionTpl: 'Profesionales de hogar y reparaciones en {city}.',
    headlineTpl:    'Hogar y reparaciones · {city}',
    tierFilter:     null,
    categoryFilter: 'hogar-reparaciones',
    verifiedFilter: null,
  },
  {
    slug:           'clases-particulares',
    titleTpl:       'Clases particulares en {city}',
    descriptionTpl: 'Profesores y clases particulares en {city}.',
    headlineTpl:    'Clases particulares · {city}',
    tierFilter:     null,
    categoryFilter: 'clases-particulares',
    verifiedFilter: null,
  },
] as const

/** Fast existence check for route-matching (catch-all last segment). */
export const SEO_SLUG_SET: ReadonlySet<string> = new Set(
  SEO_LANDING_PAGES.map(p => p.slug),
)

export function findSeoPage(slug: string): SeoLandingPage | undefined {
  return SEO_LANDING_PAGES.find(p => p.slug === slug)
}

export function fillTemplate(tpl: string, city: string): string {
  return tpl.replace(/\{city\}/g, city)
}
