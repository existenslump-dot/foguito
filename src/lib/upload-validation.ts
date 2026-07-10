/**
 * Client-side upload validation — MIME whitelist + size caps.
 *
 * Cloudinary (unsigned preset) rejects oversized files at the edge but
 * happily accepts SVG and other formats we don't want. SVG carries
 * inline `<script>` tags — a malicious upload becomes stored XSS the
 * moment it's served from `res.cloudinary.com` (same-origin from a
 * social share or an email preview, cross-origin but still capable of
 * navigation hijacking from our pages).
 *
 * This module is the authoritative client-side guard:
 *   - MIME whitelist (no `image/*` wildcards — SVG must be denied)
 *   - Per-file size cap (matches `media-limits.ts` thresholds)
 *   - Returns a structured result so callers can show the error reason
 *     verbatim in their existing toast/notification UX.
 *
 * Defense in depth — the dropzone `accept` map filters the OS picker,
 * but the user can still drop a forbidden file or hit the input via
 * scripted submission. Always re-validate inside `onDrop`.
 */

import {
  MAX_AUDIO_SIZE,
  MAX_IMAGE_SIZE,
  MAX_STORY_VIDEO_SIZE,
  formatBytes,
} from './media-limits'

// MIME whitelists — JPEG/PNG/WebP cover 99% of phone uploads; HEIC/HEIF
// are iPhone defaults (Safari < 17 leaves them untranscoded). GIF is in
// because the editor flow handles them as static frames. SVG, BMP, TIFF
// excluded — SVG is the security risk; the others are fringe formats
// Cloudinary mishandles for crops + watermarks.
export const ALLOWED_IMAGE_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
])

// Mobile recordings ride in as quicktime/mp4 from iOS, mp4/webm from
// Android. AVI / MKV would force a transcode at Cloudinary that breaks
// our story-duration validator (looks at the source duration metadata
// before upload, fails on AVI's variable framerate).
export const ALLOWED_VIDEO_MIME = new Set<string>([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
])

// Voice memos: m4a (iOS), mp3, ogg, wav. AAC + MP4 audio containers also
// frequent enough to allow.
export const ALLOWED_AUDIO_MIME = new Set<string>([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
])

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

function checkExtension(file: File, blocked: readonly string[]): string | null {
  // Some browsers report SVG dropped from a script as `text/xml` or empty
  // string; relying on `file.type` alone misses those. Sniff the
  // extension so the worst-case format (SVG) can never sneak through.
  const lower = file.name.toLowerCase()
  for (const ext of blocked) {
    if (lower.endsWith(ext)) return ext
  }
  return null
}

const BLOCKED_IMAGE_EXTS = ['.svg', '.svgz'] as const

export function validateImageFile(file: File): ValidationResult {
  const blockedExt = checkExtension(file, BLOCKED_IMAGE_EXTS)
  if (blockedExt) {
    return { ok: false, reason: `Formato ${blockedExt} no permitido` }
  }
  if (!ALLOWED_IMAGE_MIME.has(file.type)) {
    // Empty file.type happens when a file is dragged from a system
    // location that doesn't expose a registered MIME type. Treat it as
    // an unknown/forbidden format — the user can re-export to JPEG/PNG.
    const label = file.type || 'desconocido'
    return { ok: false, reason: `Imagen "${file.name}" usa un formato no soportado (${label})` }
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { ok: false, reason: `Imagen "${file.name}" supera ${formatBytes(MAX_IMAGE_SIZE)} (${formatBytes(file.size)})` }
  }
  return { ok: true }
}

export function validateVideoFile(file: File, maxSize: number = MAX_STORY_VIDEO_SIZE): ValidationResult {
  if (!ALLOWED_VIDEO_MIME.has(file.type)) {
    const label = file.type || 'desconocido'
    return { ok: false, reason: `Video "${file.name}" usa un formato no soportado (${label})` }
  }
  if (file.size > maxSize) {
    return { ok: false, reason: `Video "${file.name}" supera ${formatBytes(maxSize)} (${formatBytes(file.size)})` }
  }
  return { ok: true }
}

export function validateAudioFile(file: File): ValidationResult {
  if (!ALLOWED_AUDIO_MIME.has(file.type)) {
    const label = file.type || 'desconocido'
    return { ok: false, reason: `Audio usa un formato no soportado (${label})` }
  }
  if (file.size > MAX_AUDIO_SIZE) {
    return { ok: false, reason: `Audio supera ${formatBytes(MAX_AUDIO_SIZE)} (${formatBytes(file.size)})` }
  }
  return { ok: true }
}

/**
 * Build a `react-dropzone` accept map from the allowed MIME sets above.
 * Preferring this over `'image/*': []` is the difference between a user
 * being able to pick an SVG (browser shows it because it matches the
 * wildcard) vs not being able to. The OS picker still shows other
 * formats greyed out — defense in depth runs through onDrop too.
 */
export function dropzoneImageAccept(): Record<string, string[]> {
  return Object.fromEntries(
    Array.from(ALLOWED_IMAGE_MIME).map(m => [m, []]),
  )
}

export function dropzoneVideoAccept(): Record<string, string[]> {
  return Object.fromEntries(
    Array.from(ALLOWED_VIDEO_MIME).map(m => [m, []]),
  )
}

export function dropzoneAudioAccept(): Record<string, string[]> {
  return Object.fromEntries(
    Array.from(ALLOWED_AUDIO_MIME).map(m => [m, []]),
  )
}

/**
 * `accept` attribute string for plain `<input type="file" />` — comma-
 * separated MIMEs. Same whitelist as the dropzone map so the OS picker
 * matches whichever upload path the user takes.
 */
export const IMAGE_ACCEPT_ATTR = Array.from(ALLOWED_IMAGE_MIME).join(',')
export const VIDEO_ACCEPT_ATTR = Array.from(ALLOWED_VIDEO_MIME).join(',')
export const AUDIO_ACCEPT_ATTR = Array.from(ALLOWED_AUDIO_MIME).join(',')
