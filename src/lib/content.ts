import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * `content` row helpers — the WRITE side of a creator's content surface.
 *
 * Pilar #0 lives at the DB: `content_publish_guard` refuses to move a row to
 * `status='published'` unless (1) CSAM passed, (2) the creator is verified 18+,
 * and (3) every linked `performers_2257` record is complete. This module is the
 * bridge that creates a content DRAFT (`status='uploaded'`) and links it to the
 * creator's own 2257 performer — it NEVER publishes and NEVER certifies.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ INVARIANTE (pilar #0): the creator-facing draft path NEVER sets            │
 * │ csam_status / status='published' / published_at. A draft lands as          │
 * │ status='uploaded', csam_status='pending' (defaults) — the CSAM scanner     │
 * │ (PR-3) flips csam_status='pass' and the admin publishes (PR-3 moderation), │
 * │ both through content_publish_guard, which stays the real authority.        │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * `media_ref` is a PRIVATE storage path in the `creator-content` bucket
 * (`<creatorId>/<uuid>/media.<ext>`), NEVER a public URL. Signed delivery to a
 * paying fan is PR-5; admin review signs an ephemeral URL server-side.
 *
 * The privileged/moderation columns are DB-guarded (content_publish_guard) — so
 * every write here MUST use the service-role admin client.
 */

const CONTENT_BUCKET = 'creator-content'

export type Visibility = 'free_preview' | 'tier' | 'ppv'
export type MediaType = 'image' | 'video' | 'audio'

export type CreateContentResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

/**
 * Insert a content DRAFT. Used by the creator-facing upload flow (POST /api/content).
 *
 * ⚠️ INVARIANTE: forces `status='uploaded'` and OMITS csam_status / published_at
 * on purpose — they keep their defaults (`pending` / NULL). This path never
 * publishes; nothing goes live until CSAM passes AND an admin publishes, both
 * gated by content_publish_guard.
 *
 * MUST be called with the service-role `admin` client.
 */
export async function createContentDraft(
  admin: SupabaseClient,
  args: {
    creatorId: string
    title?: string | null
    caption?: string | null
    mediaRef: string
    mediaType: MediaType
    visibility: Visibility
    requiredTier?: string | null
    ppvPriceCredits?: number | null
  },
): Promise<CreateContentResult> {
  const {
    creatorId,
    title,
    caption,
    mediaRef,
    mediaType,
    visibility,
    requiredTier,
    ppvPriceCredits,
  } = args

  const { data, error } = await admin
    .from('content')
    .insert({
      creator_id: creatorId,
      title: title ?? null,
      caption: caption ?? null,
      media_ref: mediaRef,
      media_type: mediaType,
      visibility,
      required_tier: requiredTier ?? null,
      ppv_price_credits: ppvPriceCredits ?? null,
      // Draft only. status is pinned to 'uploaded'; csam_status / published_at
      // are DELIBERATELY OMITTED (defaults 'pending' / NULL) — see INVARIANTE.
      status: 'uploaded',
    })
    .select('id')
    .single<{ id: string }>()

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'insert failed' }
  }
  return { ok: true, id: data.id }
}

/**
 * Resolve the creator's OWN certified 2257 performer id, or null.
 *
 * The self record is auto-created + certified by the Didit 18+ webhook
 * (ensureSelfPerformerFromDidit → is_self=true, is_complete=true). We only
 * accept a COMPLETE self record — a content draft with no complete performer
 * can never publish, so the upload route fail-closes (409) when this is null.
 *
 * MUST be called with the service-role `admin` client.
 */
export async function getSelfPerformerId(
  admin: SupabaseClient,
  creatorId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('performers_2257')
    .select('id')
    .eq('added_by', creatorId)
    .eq('is_self', true)
    .eq('is_complete', true)
    .maybeSingle<{ id: string }>()
  if (error || !data) return null
  return data.id
}

/**
 * Link a performer to a content row (the N:M 2257 join). Idempotent — a repeated
 * link of the same pair is a no-op (ignoreDuplicates on the composite PK).
 *
 * MUST be called with the service-role `admin` client.
 */
export async function linkPerformer(
  admin: SupabaseClient,
  contentId: string,
  performerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin
    .from('content_performers')
    .upsert(
      { content_id: contentId, performer_id: performerId },
      { onConflict: 'content_id,performer_id', ignoreDuplicates: true },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Safe content summary for lists (no signed media — that's per-id/admin). */
export type ContentSummary = {
  id: string
  creator_id: string
  title: string | null
  caption: string | null
  media_type: MediaType | null
  visibility: Visibility
  required_tier: string | null
  ppv_price_credits: number | null
  status: string
  csam_status: string
  published_at: string | null
  created_at: string
}

const SUMMARY_COLS =
  'id, creator_id, title, caption, media_type, visibility, required_tier, ppv_price_credits, status, csam_status, published_at, created_at'

/**
 * List a creator's own content (owner-scoped read; the RLS `content_select`
 * already restricts to `creator_id = auth.uid()`, so a cookie-scoped anon
 * client is enough — no service-role needed).
 */
export async function listContentForCreator(
  client: SupabaseClient,
  creatorId: string,
): Promise<{ ok: true; content: ContentSummary[] } | { ok: false; error: string }> {
  const { data, error } = await client
    .from('content')
    .select(SUMMARY_COLS)
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })
  if (error) return { ok: false, error: error.message }
  return { ok: true, content: (data ?? []) as ContentSummary[] }
}

/**
 * List content in the given moderation statuses (the admin review queue).
 * SAFE fields only — the private media_ref is NOT returned here; the signed
 * URL is minted per-id in the admin route. MUST be admin/service-role.
 */
export async function listContentForModeration(
  admin: SupabaseClient,
  statuses: string[],
): Promise<{ ok: true; content: ContentSummary[] } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('content')
    .select(SUMMARY_COLS)
    .in('status', statuses)
    .order('created_at', { ascending: true })
  if (error) return { ok: false, error: error.message }
  return { ok: true, content: (data ?? []) as ContentSummary[] }
}

/** Full content record for admin review — includes a signed media URL. */
export type ContentReview = ContentSummary & {
  media_url: string | null
  /**
   * true when csam_status='blocked' — the media is a CSAM hit that was
   * preserved to the deny-all `csam-evidence` bucket and MUST NOT be surfaced.
   * `media_url` is null in that case (never signed).
   */
  media_blocked: boolean
}

/**
 * Load a content row + a short-lived SIGNED URL to its private media, for the
 * admin review panel.
 *
 * ⚠️ ADMIN ROUTES ONLY. The signed URL to the `creator-content` bucket must
 * NEVER reach a non-admin client — the paying-fan delivery channel (with
 * watermark + entitlement check) is PR-5. Returns null when the id is absent.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ PILAR #0: when csam_status='blocked' (a CSAM hit) we DO NOT sign the media  │
 * │ — media_url stays null and `media_blocked=true`. The admin (nor anyone)     │
 * │ must never re-view or re-propagate a hit's material: it lives blocked in    │
 * │ the deny-all bucket + preserved as evidence. The status is 'removed' too.   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * MUST be called with the service-role `admin` client.
 */
export async function getContentForReview(
  admin: SupabaseClient,
  contentId: string,
): Promise<ContentReview | null> {
  const { data, error } = await admin
    .from('content')
    .select(`${SUMMARY_COLS}, media_ref`)
    .eq('id', contentId)
    .maybeSingle<ContentSummary & { media_ref: string | null }>()

  if (error || !data) return null

  const media_blocked = data.csam_status === 'blocked'

  let media_url: string | null = null
  // NEVER sign a blocked hit's media — no re-view, no propagation.
  if (data.media_ref && !media_blocked) {
    const { data: signed } = await admin.storage
      .from(CONTENT_BUCKET)
      .createSignedUrl(data.media_ref, 3600)
    media_url = signed?.signedUrl ?? null
  }

  // Strip media_ref (the raw private path) from what leaves the building; the
  // signed URL is the only thing an admin needs.
  const { media_ref: _omit, ...summary } = data
  void _omit
  return { ...summary, media_url, media_blocked }
}
