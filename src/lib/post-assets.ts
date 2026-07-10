/**
 * Collect every Cloudinary asset URL associated with a post row so deletion
 * flows can fire `/api/media/cleanup` before dropping the DB record.
 *
 * Without this, post/account deletion only wipes the Supabase row — the
 * backing images/videos/audio stay on Cloudinary forever, burning quota
 * with no user ever referencing them again.
 *
 * The helper is deliberately permissive about shape: post rows come from
 * several codepaths (dashboard, admin, API) and carry subtly different
 * column subsets depending on the SELECT. Anything missing is just skipped.
 */

type AssetBearingPost = {
  image_urls?: string[] | null
  video_urls?: string[] | null
  video_url?: string | null
  audio_url?: string | null
  cover_video_url?: string | null
  thumbnail_url?: string | null
  id_doc_url?: string | null
}

export function collectPostAssetUrls(post: AssetBearingPost | null | undefined): string[] {
  if (!post) return []
  const urls: string[] = []
  const push = (u: unknown) => {
    if (typeof u === 'string' && u.length > 0) urls.push(u)
  }
  push(post.video_url)
  push(post.audio_url)
  push(post.cover_video_url)
  push(post.thumbnail_url)
  push(post.id_doc_url)
  if (Array.isArray(post.image_urls)) post.image_urls.forEach(push)
  if (Array.isArray(post.video_urls)) post.video_urls.forEach(push)
  // Dedup — covers come from image_urls too, id_doc_url can overlap etc.
  return Array.from(new Set(urls))
}
