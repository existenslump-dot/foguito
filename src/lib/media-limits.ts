/**
 * Client-side size caps for user uploads.
 *
 * These are UX guards — the authoritative limits live in the Cloudinary
 * preset config (unsigned uploads reject oversized files at the edge).
 * Client-side checks just give fast feedback instead of a silent HTTP 400
 * after the user waited for a 200MB upload.
 *
 * Numbers picked for the feature:
 *   - Stories are 30s vertical clips; 100MB handles up to ~4K source with
 *     plenty of headroom for H.264. Beyond that is almost certainly a
 *     misexport.
 *   - Cover videos on Gold/Elite are short loops; 50MB matches the existing
 *     inline checks in admin/create + dashboard/edit.
 *   - Audio bios are typically 15–30s voice recordings; 10MB is generous.
 */

export const MAX_STORY_VIDEO_SIZE  = 100 * 1024 * 1024 // 100 MB
export const MAX_COVER_VIDEO_SIZE  =  50 * 1024 * 1024 //  50 MB
export const MAX_AUDIO_SIZE        =  10 * 1024 * 1024 //  10 MB
export const MAX_IMAGE_SIZE        =  20 * 1024 * 1024 //  20 MB

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}
