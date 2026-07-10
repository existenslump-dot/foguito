/**
 * Post row shape used across the UI (feed cards, detail page, dashboard,
 * admin moderation, recommendations). Mirrors the `posts` table plus legacy
 * fields kept for backwards-compat.
 *
 * All fields are optional except `id` — Supabase selects often cherry-pick
 * columns, so consumers should treat missing fields as undefined rather
 * than accessing them unguarded.
 */

export type PostStatus = 'pending' | 'published' | 'rejected' | 'revision' | 'draft'

export type PostTier = 'basic' | 'bronze' | 'silver' | 'gold' | 'elite' | string

export type Post = {
  id: string

  title?: string
  post_slug?: string
  description?: string
  user_id?: string | null

  status?: PostStatus
  is_approved?: boolean | null
  is_hidden?: boolean | null
  is_paused?: boolean | null
  rejection_reason?: string | null
  parent_post_id?: string | null
  approved_at?: string | null

  category?: string
  tier?: PostTier

  price?: number | null
  price_usd?: number | null
  price_eur?: number | null
  currency?: string | null
  is_promoted?: boolean | null
  promo_price?: number | null
  promo_ends_at?: string | null
  is_pinned?: boolean | null
  pin_ends_at?: string | null
  is_boosted?: boolean | null
  boost_ends_at?: string | null

  localidad?: string
  country_id?: string | null
  provincia_id?: string | null
  comuna_id?: string | null
  barrio_id?: string | null

  // Joined geo relations — populated when the query embeds them via
  // `.select('*, countries(slug,name), provincias(slug,name), ...')`.
  // Supabase returns these as either an object or single-element array
  // depending on the generated typing; use `postCountrySlug(post)` /
  // `postGeoDisplay(post)` from geo.ts to handle both shapes.
  countries?:  { slug: string; name: string } | { slug: string; name: string }[] | null
  provincias?: { slug: string; name: string } | { slug: string; name: string }[] | null
  comunas?:    { slug: string; name: string } | { slug: string; name: string }[] | null
  barrios?:    { slug: string; name: string } | { slug: string; name: string }[] | null

  whatsapp_number?: string | null
  telegram_number?: string | null

  image_urls?: string[]
  video_urls?: string[]
  audio_url?: string | null
  audio_filename?: string | null
  cover_video_url?: string | null
  profile_photo_url?: string | null

  // Listing attributes — config-driven, keyed by AttributeDef.key from
  // src/config/attributes.config.ts. Persisted in the `attributes` JSONB
  // column. Values are scalars or string arrays depending on the attribute
  // type (text/number/select/multiselect/boolean).
  attributes?: Record<string, string | number | boolean | string[] | null>

  identity_verified?: boolean
  id_document_url?: string | null

  is_online?: boolean
  favorites_count?: number

  is_free_trial?: boolean
  expires_at?: string | null

  created_at?: string
  updated_at?: string
  paused_at?: string | null
  published_at?: string | null

  author?: string | null
  views?: number
  comments_count?: number
  slug?: string | null
}

/** Minimal shape used by admin moderation tables — derived from Post. */
export type AdminPost = Pick<
  Post,
  'id' | 'title' | 'status' | 'tier' | 'category' | 'user_id' |
  'image_urls' | 'is_approved' | 'is_hidden' |
  'rejection_reason' | 'created_at' | 'parent_post_id' | 'id_document_url' |
  'identity_verified'
>

/**
 * Stricter shape for feed cards.
 *
 * `CityClient` renders posts assuming `price` (number) + `image_urls` (array
 * with at least one URL) + `title` are always present — any row in the
 * approved/published feed must satisfy these. Filtering at the query layer
 * (posts.select('*').eq('status','published')) historically returns these
 * set, but the loose `Post` type marks them optional to match DB NULLs.
 *
 * Use `FeedPost` at feed-card render sites to let TypeScript verify the
 * narrow without littering `?? ''` fallbacks.
 */
export type FeedPost = Omit<
  Post,
  'price' | 'image_urls' | 'title'
> & {
  price: number
  image_urls: string[]
  title: string
}

/** Story row — per-post ephemeral video (24h). */
export type Story = {
  id: string
  post_id?: string
  user_id?: string
  video_url?: string
  thumbnail_url?: string | null
  status?: 'pending' | 'approved' | 'rejected'
  rejection_reason?: string | null
  city?: string
  country_id?: string | null
  expires_at?: string
  created_at?: string
  // Denormalized counters — bumped via RPC (increment_story_views /
  // adjust_story_likes).
  views?: number
  likes?: number
  // Joined post data (stories queries often .select('*, posts(...)')).
  posts?: {
    title?: string
    image_urls?: string[]
    country_id?: string | null
    localidad?: string
    countries?: { slug: string; name: string } | { slug: string; name: string }[] | null
  }
}
