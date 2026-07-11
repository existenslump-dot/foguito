/**
 * Magic-byte media sniffing — decide a file's REAL category from its bytes, not
 * from a client-declared MIME or filename (both forgeable).
 *
 * ┌── Por qué existe (PR-5 hardening) ─────────────────────────────────────────┐
 * │ El alta de contenido derivaba `media_type` del `Content-Type` multipart que  │
 * │ manda el browser — atacable. Un creador podía subir bytes de imagen         │
 * │ declarando `video/mp4`: la pieza quedaba `media_type='video'` y el endpoint  │
 * │ de entrega la servía por la rama de video (URL firmada, 302) SIN la marca de │
 * │ agua por-fan → una imagen filtrada dejaba de ser trazable (justo lo que la   │
 * │ marca evita). Sniffeando los bytes reales en el alta y rechazando cuando el  │
 * │ tipo declarado no coincide, `media_type` pasa a ser AUTORITATIVO.            │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * Es una función pura sobre los primeros bytes del archivo (con ~16 alcanza para
 * las firmas; pasarle 4 KB es holgado). No hace I/O. Devuelve la categoría o
 * 'other' cuando no reconoce la firma (el llamador debe fail-closear ante 'other').
 */

export type MediaCategory = 'image' | 'video' | 'audio' | 'other'

/** Marcas ISO-BMFF (`ftyp`) que son IMÁGENES (HEIF/HEIC/AVIF), no video. */
const HEIF_IMAGE_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx',
  'heif', 'mif1', 'msf1', 'avif', 'avis',
])

/** Marcas ISO-BMFF (`ftyp`) que son AUDIO. */
const ISOBMFF_AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'F4A ', 'F4B '])

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = ''
  for (let i = start; i < start + len && i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i])
  }
  return s
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false
  }
  return true
}

/**
 * Categoriza un archivo por sus bytes iniciales. Cubre las firmas de los formatos
 * que el alta acepta hoy (imagen: jpeg/png/webp/gif/heic-heif; video:
 * mp4/mov/m4v/webm) más audio común (para completitud; el alta aún no lo acepta).
 */
export function sniffMediaCategory(bytes: Uint8Array): MediaCategory {
  // ── Imágenes por firma directa ──────────────────────────────────────────────
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image'
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image'
  // GIF: "GIF8"
  if (ascii(bytes, 0, 4) === 'GIF8') return 'image'
  // RIFF container: distinguir WEBP (imagen) de WAVE/AVI por el sub-tipo en 8..11
  if (ascii(bytes, 0, 4) === 'RIFF') {
    const sub = ascii(bytes, 8, 4)
    if (sub === 'WEBP') return 'image'
    if (sub === 'WAVE') return 'audio'
    if (sub === 'AVI ') return 'video'
    return 'other'
  }

  // ── Contenedores ISO-BMFF (`ftyp` en 4..7): la MARCA decide imagen/video/audio ─
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4)
    if (HEIF_IMAGE_BRANDS.has(brand)) return 'image'
    if (ISOBMFF_AUDIO_BRANDS.has(brand)) return 'audio'
    // isom/iso2/mp41/mp42/M4V /qt  /avc1/dash/… → video
    return 'video'
  }

  // ── Video Matroska/WebM: EBML 1A 45 DF A3 ────────────────────────────────────
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video'

  // ── Audio suelto ─────────────────────────────────────────────────────────────
  // MP3: "ID3" (tag) o frame sync FF Ex/Fx
  if (ascii(bytes, 0, 3) === 'ID3') return 'audio'
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio'
  // OGG: "OggS"
  if (ascii(bytes, 0, 4) === 'OggS') return 'audio'

  return 'other'
}
