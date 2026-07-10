/**
 * Shapes consumed by the admin panel (admin/page.tsx + components/admin/*).
 *
 * Each type mirrors what the Supabase query selects — intentionally narrow
 * (only the fields the UI reads) so consumers stay forgiving when the
 * underlying rows grow. Use `Pick<Post, ...>` when you need a tighter
 * subset of an existing domain type.
 */

import type { Post } from './post'

type GeoRelation = { slug?: string; name?: string }
type PostGeoJoin = {
  title?: string
  image_urls?: string[]
  localidad?: string
  country_id?: string | null
  countries?: GeoRelation | GeoRelation[] | null
}

/** `reports` row joined with parent post (for URL + thumbnail). */
export type AdminReport = {
  id:           string
  post_id:      string
  category:     string
  description?: string | null
  status?:      'pending' | 'dismissed' | 'actioned' | string
  created_at:   string
  posts?:       PostGeoJoin | null
}

/**
 * `stories` row joined with parent post + reporter profile.
 *
 * `status` is typed as plain string to match test fixtures and to stay
 * forgiving if new states are added DB-side before the type catches up.
 */
export type AdminStoryRow = {
  id:             string
  post_id:        string
  user_id?:       string
  video_url?:     string
  thumbnail_url?: string | null
  status?:        string
  created_at:     string
  rejection_reason?: string | null
  posts?: (PostGeoJoin & { user_id?: string }) | null
  profiles?: { email?: string; full_name?: string | null } | null
}

/** `reviews` row with minimal joined post context. */
export type AdminReview = {
  id:            string
  post_id:       string
  rating:        number
  comment?:      string | null
  reviewer_name?: string | null
  approved?:     boolean
  created_at?:   string
  posts?:        { id?: string; title?: string } | null
}

/**
 * `profiles` row filtered for verification queue.
 *
 * `verification_status` stays as plain string — DB has it as text column,
 * and fixtures/tests pass arbitrary literals.
 */
export type AdminVerification = {
  id:                      string
  full_name?:              string | null
  email:                   string
  identity_doc_url?:       string | null
  identity_selfie_url?:    string | null
  identity_video_url?:     string | null
  verification_status:     string
  created_at:              string
}

/** `countries` row — what AdminGeo + cityCat visibility matrix needs. */
export type AdminCountry = {
  id:         string
  slug:       string
  name:       string
  active:     boolean
  sort_order?: number
}

/** `categories` row — dynamic categories in admin. */
export type AdminCategory = {
  id:     string
  name:   string
  slug:   string
  active: boolean
  order?: number
}

/** `city_category_settings` row — visibility matrix city × category. */
export type CityCategorySetting = {
  id?:           string
  city_slug:     string
  category_slug: string
  visible:       boolean
  updated_at?:   string
}

/** Support-chat thread summary (aggregated client-side from messages). */
export type SupportThread = {
  userId:      string
  name:        string
  lastMessage: string
  lastTime:    string
  unread:      number
}

/** Single support-chat message row. */
export type SupportMessage = {
  id:         string
  user_id:    string
  message:    string
  sender:     'user' | 'admin'
  read:       boolean
  created_at: string
}

/** `posts` row as the admin panel uses it (with joined geo relations). */
export type AdminPost = Post
