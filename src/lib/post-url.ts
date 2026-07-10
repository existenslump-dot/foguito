import type { CategoryId } from '@/lib/categories'
import { pickRelation } from '@/lib/geo'
import { isReservedSlug } from '@/lib/reserved-slugs'
import { MARKETPLACE } from '@/config/marketplace.config'

// Category id (stored in posts.category) → slug used in the URL. For the
// local-services example vertical the URL slug matches the category id, so
// this is an identity map; keep it in sync with CATEGORIES.
export const CATEGORY_PLURAL: Record<CategoryId, string> = {
  'hogar-reparaciones': 'hogar-reparaciones',
  'clases-particulares': 'clases-particulares',
  'belleza-bienestar': 'belleza-bienestar',
  'eventos-fotografia': 'eventos-fotografia',
  'tecnologia': 'tecnologia',
  'salud': 'salud',
}

export const PLURAL_TO_CATEGORY: Record<string, CategoryId> = {
  'hogar-reparaciones': 'hogar-reparaciones',
  'clases-particulares': 'clases-particulares',
  'belleza-bienestar': 'belleza-bienestar',
  'eventos-fotografia': 'eventos-fotografia',
  'tecnologia': 'tecnologia',
  'salud': 'salud',
}

/** Fast existence check for route-matching. */
export const CATEGORY_PLURAL_SET: ReadonlySet<string> = new Set(
  Object.keys(PLURAL_TO_CATEGORY),
)

type PostUrlInput = {
  category?:   string | null
  post_slug?:  string | null
  id?:         string
  title?:      string | null
  countries?:  { slug?: string | null; name?: string | null } | Array<{ slug?: string | null; name?: string | null }> | null
  provincias?: { slug?: string | null } | Array<{ slug?: string | null }> | null
  comunas?:    { slug?: string | null } | Array<{ slug?: string | null }> | null
}

/**
 * Slugify a post title for URL use — strips accents, lowercases, hyphenates.
 * Mirrors the client-side slug logic in admin/create so a post that was
 * created without an explicit post_slug still gets a consistent URL.
 */
export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return isReservedSlug(base) ? `${base}-perfil` : base
}

export function postCanonicalPath(post: PostUrlInput): string {
  if (post.post_slug && !isReservedSlug(post.post_slug)) {
    return `/${post.post_slug}`
  }

  const country = pickRelation(post.countries)?.slug || MARKETPLACE.market.defaultCountrySlug
  const alias   = post.post_slug
             ?? (post.title ? slugifyTitle(post.title) : post.id)
  return `/${country}/post/${alias}`
}
