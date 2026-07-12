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

/** UUID guard — mirrors the admin content route's UUID_RE (fail-closed on junk ids). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
 * Teaser PÚBLICO de una pieza publicada — metadata SEGURA para descubrir
 * contenido bloqueado sin filtrar el media (PR-6). NUNCA incluye `media_ref`.
 *
 * La página de perfil usa esto (vía service-role) para listar TODAS las piezas
 * published+pass de la creadora, incluidas las que el fan aún NO desbloqueó, y
 * mostrar un teaser (título + precio + botón) — mientras que la RLS decide qué
 * media se entrega. Una tarjeta bloqueada NUNCA apunta al endpoint de media.
 */
export type ContentTeaser = {
  id: string
  creator_id: string
  title: string | null
  caption: string | null
  media_type: MediaType | null
  visibility: Visibility
  required_tier: string | null
  ppv_price_credits: number | null
  published_at: string | null
}

const TEASER_COLS =
  'id, creator_id, title, caption, media_type, visibility, required_tier, ppv_price_credits, published_at'

/**
 * Lista los teasers (metadata SEGURA, sin media) de TODAS las piezas
 * published + csam-pass de una creadora, para el descubrimiento en el perfil.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ INVARIANTE: NUNCA se selecciona `media_ref`. Esto lista piezas que el fan   │
 * │ tal vez NO puede ver (bloqueadas) — el media jamás se filtra: la entrega    │
 * │ sigue pasando por la RLS + el endpoint gateado. Sólo metadata + precio.     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Corre con el service-role `admin` (necesita ver piezas que la RLS del fan
 * ocultaría). Orden: más nuevas primero.
 */
export async function listCreatorTeasers(
  admin: SupabaseClient,
  creatorId: string,
): Promise<ContentTeaser[]> {
  const { data, error } = await admin
    .from('content')
    .select(TEASER_COLS)
    .eq('creator_id', creatorId)
    .eq('status', 'published')
    .eq('csam_status', 'pass')
    .order('published_at', { ascending: false, nullsFirst: false })
  if (error || !data) return []
  return data as ContentTeaser[]
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

/**
 * Internal, SERVER-ONLY projection for the paid-fan delivery channel (PR-5).
 *
 * ⚠️ `media_ref` (the raw private `creator-content` path) is included ON PURPOSE
 * so the delivery endpoint can download/sign the binary — but it MUST stay
 * server-side. The endpoint NEVER echoes `media_ref` (nor, for images, a raw
 * signed URL) back to the client; images are streamed as watermarked bytes.
 */
export type ContentForDelivery = {
  id: string
  creator_id: string
  media_ref: string
  media_type: MediaType
  visibility: Visibility
}

/**
 * Resolve a single content row for DELIVERY to a paying/entitled fan (PR-5).
 *
 * ┌── PAYWALL: single source of truth = RLS `content_select` ──────────────────┐
 * │ The SELECT runs with the FAN's cookie-scoped client, so RLS is what decides │
 * │ visibility: a row comes back ONLY if the fan is the creator, an admin, or    │
 * │ the piece is published + csam-pass AND (free_preview | a non-expired         │
 * │ entitlement | an active subscription). We do NOT re-implement the paywall    │
 * │ here — a non-entitled fan simply gets no row → null. NEVER pass a            │
 * │ service-role client as `fanClient`: that bypasses RLS and hands out          │
 * │ everyone's private media.                                                    │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * BELT-AND-SUSPENDERS beyond RLS (PILAR #0): even if a row comes back we refuse
 * to proceed unless `status='published'` AND `csam_status='pass'` AND a
 * `media_ref` is present. We NEVER hand back a path to unscanned / blocked /
 * draft media, whatever RLS said.
 *
 * FAIL-CLOSED: invalid id, query error, no row, or the guard above ⇒ null. The
 * caller MUST treat null as an opaque 404 — "not entitled" and "not found" look
 * identical, so there is no entitlement oracle.
 *
 * `admin` is accepted for call-site symmetry with the delivery endpoint (which
 * also holds the service-role signer); the ACCESS decision here uses ONLY
 * `fanClient`. The returned object carries `media_ref` — the caller MUST NOT
 * leak it (see the endpoint's file header).
 */
export async function getContentForDelivery(
  fanClient: SupabaseClient,
  admin: SupabaseClient,
  contentId: string,
): Promise<ContentForDelivery | null> {
  void admin // access uses fanClient (RLS) only; admin is the endpoint's signer
  if (!UUID_RE.test(contentId)) return null

  const { data, error } = await fanClient
    .from('content')
    .select(`${SUMMARY_COLS}, media_ref`)
    .eq('id', contentId)
    .maybeSingle<ContentSummary & { media_ref: string | null }>()

  if (error || !data) return null // fail-closed: not-entitled ≡ not-found

  // Double-guard past RLS: never sign/serve unpublished, unscanned, or blocked.
  if (
    data.status !== 'published' ||
    data.csam_status !== 'pass' ||
    !data.media_ref ||
    !data.media_type
  ) {
    return null
  }

  return {
    id: data.id,
    creator_id: data.creator_id,
    media_ref: data.media_ref,
    media_type: data.media_type,
    visibility: data.visibility,
  }
}
