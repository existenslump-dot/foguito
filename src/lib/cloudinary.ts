import { MARKETPLACE } from '@/config/marketplace.config'

// Cloudinary cloud name — from the active marketplace config so each
// deployment points at its own Cloudinary account without a code change.
const CLOUD = MARKETPLACE.integrations.cloudinary.cloud

const TIER_PARAMS: Record<string, { w: number; h: number; q: number }> = {
  // Unified across all tiers (600×970 q85, golden-ratio portrait). Tier
  // differentiation lives elsewhere in the UI (card ordering, tier badge,
  // card size in the grid, video portada for Gold/Elite); keeping one
  // resolution means the brand watermark reads crisp on every card. q85
  // webp is visually equivalent to ~q92 JPEG while keeping bandwidth
  // predictable.
  elite:    { w: 600, h: 970, q: 85 },
  gold:   { w: 600, h: 970, q: 85 },
  silver:   { w: 600, h: 970, q: 85 },
  bronze:   { w: 600, h: 970, q: 85 },
  basic: { w: 600, h: 970, q: 85 },
}

/**
 * Build a Cloudinary URL with tier-based transformations + the Marketplace
 * watermark overlay.
 *
 * The watermark is applied to **every tier** — the render-time overlay is the
 * sole source of brand watermarking in the app, so admins always upload clean
 * source images and Cloudinary bakes the overlay at the edge when the URL is
 * requested.
 *
 * Order matters: size transform first, then the watermark overlay, so
 * `fl_relative` resolves against the rendered thumbnail (otherwise the
 * overlay inherits the raw asset dimensions and looks oversized on
 * compact cards).
 *
 * Falls back to the original URL if it's not a Cloudinary URL or the
 * publicId can't be extracted.
 */
export function getCloudinaryUrl(urlOrPublicId: string, tier: string): string {
  if (!urlOrPublicId) return urlOrPublicId
  const p = TIER_PARAMS[tier] ?? TIER_PARAMS.basic

  // If it's already a full Cloudinary URL, extract the cloud + public_id.
  const match = urlOrPublicId.match(/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:v\d+\/)?(.+)$/)
  if (!match) return urlOrPublicId
  const [, urlCloud, publicId] = match
  // Only transform assets that live on OUR configured cloud. Demo/seed images
  // and external imports (a different cloud) — or any URL when no cloud is
  // configured — pass through untouched instead of being rewritten to a broken
  // `res.cloudinary.com//image/upload/...` (empty cloud) URL.
  if (!CLOUD || urlCloud !== CLOUD) return urlOrPublicId

  const size = `w_${p.w},h_${p.h},c_fill,q_${p.q},f_webp`
  const transform = WATERMARK_ID
    ? `${size}/l_${WATERMARK_ID},${WATERMARK_OPTS}`
    : size

  return `https://res.cloudinary.com/${CLOUD}/image/upload/${transform}/${publicId}`
}

/**
 * Square thumbnail variant with a prominent watermark — sized for the
 * compact 108-110 px panels in /dashboard PostsGrid (retina: 220 px).
 *
 * `getCloudinaryUrl` above produces tier-shaped portraits (360×582 for
 * BRONZE etc) which then get cropped a second time by `object-fit: cover`
 * inside the square card, and the watermark sized at 75% of the portrait
 * gets compressed thin when scaled into a square. This helper:
 *   - Crops square once, server-side, so the displayed pixels match
 *     what Cloudinary cropped (no double-crop loss)
 *   - Bumps the watermark to 85% relative + 85% opacity so the
 *     "Marketplace" lockup remains legible even at the small render size
 *
 * Falls back to the raw URL when the asset isn't on our Cloudinary cloud.
 */
export function getCloudinaryThumbUrl(urlOrPublicId: string, size = 220): string {
  if (!urlOrPublicId) return urlOrPublicId
  const match = urlOrPublicId.match(/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:v\d+\/)?(.+)$/)
  if (!match) return urlOrPublicId
  const [, urlCloud, publicId] = match
  if (!CLOUD || urlCloud !== CLOUD) return urlOrPublicId

  const sizeOpts = `w_${size},h_${size},c_fill,q_75,f_webp`
  const transform = WATERMARK_ID
    ? `${sizeOpts}/l_${WATERMARK_ID},${THUMB_WATERMARK_OPTS}`
    : sizeOpts

  return `https://res.cloudinary.com/${CLOUD}/image/upload/${transform}/${publicId}`
}

/**
 * Build a Cloudinary URL for the social-share preview (OG image) of a post.
 *
 * Output is the portada cropped to golden-ratio portrait (1080×1747) with
 * the brand watermark centered at 75% relative size / 80% opacity — same
 * styling as feed cards on /[city] so the preview matches what the user
 * sees inside the app.
 *
 * `g_auto` is Cloudinary's saliency-aware crop. On a 1080×1747 portrait
 * frame it tends to keep the subject in the safe area even when the
 * source aspect is wider than 0.618. `q_auto,f_jpg` keeps the
 * file under ~250 KB and uses JPG for maximum scraper compatibility
 * (FB/WhatsApp accept WebP too but JPG has zero edge cases).
 *
 * Falls back to the raw URL when the asset isn't on our Cloudinary cloud
 * (legacy posts, external imports) — the platform scraper will then crop
 * however it sees fit, same as today.
 */
export function getCloudinaryOgImage(urlOrPublicId: string): string {
  if (!urlOrPublicId) return urlOrPublicId
  const match = urlOrPublicId.match(/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:v\d+\/)?(.+)$/)
  if (!match) return urlOrPublicId
  const [, urlCloud, publicId] = match
  if (!CLOUD || urlCloud !== CLOUD) return urlOrPublicId

  const size = 'w_1080,h_1747,c_fill,g_auto,q_auto,f_jpg'
  const transform = WATERMARK_ID
    ? `${size}/l_${WATERMARK_ID},${WATERMARK_OPTS}`
    : size

  return `https://res.cloudinary.com/${CLOUD}/image/upload/${transform}/${publicId}`
}

/**
 * Build a Cloudinary video poster (thumbnail) URL from a video URL.
 */
export function getVideoPosterUrl(videoUrl: string): string {
  if (!videoUrl) return ''
  const match = videoUrl.match(/res\.cloudinary\.com\/[^/]+\/video\/upload\/(?:v\d+\/)?(.+)$/)
  const publicId = match ? match[1].replace(/\.[^.]+$/, '') : null
  if (!publicId) return ''
  return `https://res.cloudinary.com/${CLOUD}/video/upload/w_600,h_970,so_0,f_jpg/${publicId}.jpg`
}

// Uploads are unsigned (preset `app_preset`), so we can't inject eager
// transformations at upload time. Instead we apply the overlay as a URL
// transformation at display time — Cloudinary re-encodes on the fly and
// caches the result at their edge. The raw (un-watermarked) asset stays
// at the original URL but is never referenced from the app, so a casual
// "save video as…" from the browser captures the watermarked version.
//
// The watermark's public_id is env-driven so the user can drop the logo
// anywhere in their Cloudinary library and point the app at it without
// a redeploy. When unset, the helpers no-op and return the raw URL —
// the feature just isn't active.
//
// NEXT_PUBLIC_CLOUDINARY_WATERMARK_ID format:
//   - Plain asset:  "logo"
//   - In a folder:  "marketplace:logo"   (colons separate folder segments in URL params)

const WATERMARK_RAW  = process.env.NEXT_PUBLIC_CLOUDINARY_WATERMARK_ID
// Watermark styling: centered, 80% opacity so the watermark reads clearly on
// low-contrast frames without being opaque enough to crowd out the subject.
//
// Two variants ship side-by-side:
//
//   • WATERMARK_OPTS (relative): used by card thumbnails via
//     getCloudinaryUrl — thumbs are already cropped to fixed tier sizes
//     (280×452 → 600×970), so `fl_relative,w_0.75,h_0.75,c_fit` scales
//     the mark to 75% of the rendered thumb regardless of tier.
//
//   • WATERMARK_OPTS_FIXED (absolute): used by getWatermarkedImageUrl for
//     gallery / hero images that are served near their upload size.
//     Relative sizing produced a wider watermark on landscape (1748×1080)
//     than on portrait (1080×1748) variants of the same post because
//     `w_0.75` expands with image width. Pinning the box to a square
//     720×720 with `c_fit` means a wide logo lands at the same absolute
//     size on both orientations — shorter-side coverage differs, but the
//     mark itself reads as one consistent size across the gallery.
const WATERMARK_OPTS       = 'c_fit,w_0.75,h_0.75,fl_relative,fl_layer_apply,g_center,o_80'
// Square thumbnail variant — bumped to 85% relative + 85% opacity so the
// "Marketplace" lockup stays legible when downsampled from the 220 px
// retina source to the 108-110 px CSS render size.
const THUMB_WATERMARK_OPTS = 'c_fit,w_0.85,h_0.85,fl_relative,fl_layer_apply,g_center,o_85'
// `c_scale,w_720` (no height, no c_fit) forces the overlay to exactly
// 720 px wide while preserving its aspect, and — unlike `c_fit` — allows
// upscaling when the source logo asset is smaller than the target box.
// The previous `c_fit,w_720,h_720` caused the mark to vanish on posts
// whose logo asset was ≤720 px wide, because c_fit won't upscale and the
// watermark silently dropped back to its native size, which was nearly
// invisible against 1748 px landscape frames.
const WATERMARK_OPTS_FIXED = 'c_scale,w_720,fl_layer_apply,g_center,o_80'

/**
 * Normalize the watermark env var into a Cloudinary public_id that can be
 * passed to an `l_<id>` overlay parameter.
 *
 * Accepts three formats (in order):
 *   1. Plain public_id ("marketplace-logo" or "marketplace:logo" for folders) — used as-is
 *   2. Full Cloudinary URL ("https://res.cloudinary.com/<cloud>/image/upload/
 *      v.../marketplace-logo.png") — extract the public_id portion
 *   3. Anything else — returns null and the watermark no-ops
 *
 * The accepted forms let the user drop any shareable Cloudinary URL into
 * Vercel env vars without having to remember the raw public_id format.
 */
function resolveWatermarkId(raw: string | undefined): string | null {
  if (!raw) return null
  // Full Cloudinary image URL — extract the path after /upload/, strip the
  // version prefix and file extension. Cloudinary overlays reference the
  // public_id, not the rendered URL.
  const match = raw.match(/res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:v\d+\/)?(.+)$/)
  if (match) return match[1].replace(/\.[^.]+$/, '')
  // Looks like a URL but not ours — bail rather than produce a broken overlay.
  if (/^https?:\/\//.test(raw)) return null
  return raw
}

const WATERMARK_ID = resolveWatermarkId(WATERMARK_RAW)

function injectTransform(url: string, kind: 'video' | 'image', transform: string): string {
  if (!url) return url
  // Keep the original if it isn't on our Cloudinary cloud (legacy URLs,
  // blob previews during uploads, etc.) — transforming an unrelated host
  // returns a 404.
  const re = new RegExp(`res\\.cloudinary\\.com/${CLOUD}/${kind}/upload/`)
  if (!re.test(url)) return url
  return url.replace(
    `/${kind}/upload/`,
    `/${kind}/upload/${transform}/`,
  )
}

/** Video URL with the Marketplace logo burned into the bottom-right corner.
 *  Overlay syntax is `l_<public_id>,<opts>` — `l_image:<url>` is NOT valid
 *  Cloudinary syntax and returns 400 Bad Request. */
export function getWatermarkedVideoUrl(url: string): string {
  if (!WATERMARK_ID || !url) return url
  return injectTransform(url, 'video', `l_${WATERMARK_ID},${WATERMARK_OPTS}`)
}

/** Image URL with the Marketplace logo burned into the bottom-right corner. */
export function getWatermarkedImageUrl(url: string): string {
  if (!WATERMARK_ID || !url) return url
  return injectTransform(url, 'image', `if_w_lt_720,c_scale,w_720/l_${WATERMARK_ID},${WATERMARK_OPTS_FIXED}`)
}

/** Profile-circle variant of the cover photo (mobile 210px, desktop 380px). */
export function getProfileCircleUrl(urlOrPublicId: string): string {
  if (!urlOrPublicId) return urlOrPublicId

  // Demo/seed imagery on Unsplash: fit=facearea centres tightly on the detected
  // face (ideal for the circular avatar) and falls back to centre when there's
  // no face, so portraits crop to the face instead of the geometric middle.
  if (/images\.unsplash\.com\//.test(urlOrPublicId)) {
    const base = urlOrPublicId.split('?')[0]
    return `${base}?auto=format&fit=facearea&facepad=3&w=420&h=420&q=85`
  }

  const match = urlOrPublicId.match(/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:v\d+\/)?(.+)$/)
  if (!match) return urlOrPublicId
  const [, urlCloud, publicId] = match
  if (!CLOUD || urlCloud !== CLOUD) return urlOrPublicId

  const cropChain = 'e_trim/w_420,h_420,c_fill,g_auto:face,q_85,f_webp'
  const transform = WATERMARK_ID
    ? `${cropChain}/l_${WATERMARK_ID},${WATERMARK_OPTS}`
    : cropChain

  return `https://res.cloudinary.com/${CLOUD}/image/upload/${transform}/${publicId}`
}

