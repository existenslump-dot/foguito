import 'server-only'
import sharp from 'sharp'

/**
 * Marca de agua POR-FAN para el canal de entrega de contenido pagado (PR-5).
 *
 * Se compone SERVER-SIDE: los bytes originales del `creator-content` bucket se
 * descargan con service-role, se les tatúa una marca visible identificando al
 * fan, y recién eso viaja al cliente. Así la URL firmada del binario original
 * NUNCA llega al browser (imágenes) y, si una imagen se filtra, la marca apunta
 * al fan que la descargó (forense de leaks).
 *
 * La etiqueta es SEUDÓNIMA (sin PII): prefijos de ids + fecha. Nada de email ni
 * ids completos que permitan doxear.
 *
 * NOTA (deuda diferida): el burn-in por-fan de VIDEO/AUDIO es demasiado caro por
 * request → el endpoint entrega esos con una URL firmada de vida corta. Migrar a
 * un pipeline de media (transcode + marca) es un PR posterior.
 */

// Opacidad de la marca: visible pero no destructiva del contenido.
const WATERMARK_OPACITY = 0.2
// Dimensiones de fallback si `sharp` no pudo leer el tamaño (imagen rara/corrupta).
const FALLBACK_DIM = 1080
// Techo de píxeles al decodificar (defensa en profundidad vs bomba de
// descompresión: el alta ya lo acota, pero la entrega decodifica en CADA vista,
// así que también se acota acá — sharp tira si se excede y el endpoint fail-closea
// a 404). Debe coincidir con MAX_IMAGE_PIXELS del alta (~100 MP).
const MAX_DECODE_PIXELS = 100_000_000

/** Escapa lo mínimo para no romper el XML del SVG (la etiqueta es texto libre). */
function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) =>
    c === '<'
      ? '&lt;'
      : c === '>'
        ? '&gt;'
        : c === '&'
          ? '&amp;'
          : c === "'"
            ? '&apos;'
            : '&quot;',
  )
}

/**
 * Etiqueta seudónima que identifica al fan SIN PII. Prefijos de 8 chars de cada
 * id (suficiente para forense, no reversible a la identidad) + la fecha del día.
 * NUNCA incluir email ni ids completos.
 */
export function buildFanLabel(fanId: string, contentId: string): string {
  const day = new Date().toISOString().slice(0, 10)
  return `${fanId.slice(0, 8)} · ${contentId.slice(0, 8)} · ${day}`
}

/**
 * SVG de marca de agua que llena TODO el lienzo: un `<pattern>` de texto repetido
 * en diagonal (rotado -30°). Al estar teselado por toda la imagen, un recorte no
 * puede eliminar todas las repeticiones. Texto blanco con un trazo oscuro tenue
 * para que se lea sobre cualquier fondo.
 */
export function buildFanWatermarkSvg(width: number, height: number, label: string): string {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const safe = escapeXml(label)
  // Tesela y tipografía escalan con la imagen para que la marca se lea igual en
  // una miniatura o en una foto grande.
  const tile = Math.max(160, Math.round(Math.min(w, h) / 3))
  const fontSize = Math.max(13, Math.round(tile / 11))
  const strokeOpacity = (WATERMARK_OPACITY * 0.6).toFixed(3)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs>` +
    `<pattern id="fwm" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">` +
    `<text x="0" y="${Math.round(tile / 2)}" font-family="Arial, Helvetica, sans-serif" ` +
    `font-size="${fontSize}" font-weight="700" letter-spacing="2" ` +
    `fill="#FFFFFF" fill-opacity="${WATERMARK_OPACITY}" ` +
    `stroke="#000000" stroke-opacity="${strokeOpacity}" stroke-width="0.6">${safe}</text>` +
    `</pattern>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#fwm)"/>` +
    `</svg>`
  )
}

/**
 * Resultado del tatuado: los bytes marcados + el Content-Type AUTORITATIVO con
 * el que quedaron codificados (para que el endpoint no tenga que adivinarlo).
 */
export type WatermarkResult = { data: Buffer; contentType: string }

/**
 * Compone la marca de agua por-fan sobre una imagen y devuelve los bytes finales.
 *
 * - `.rotate()` sin ángulo auto-orienta según EXIF. Para orientaciones 5-8 (giros
 *   de 90°/270°) el ancho/alto FINAL se intercambian, así que el lienzo del SVG
 *   se calcula sobre las dimensiones YA rotadas para que el composite calce exacto.
 * - Preserva PNG/WEBP; cualquier otra cosa (jpeg/gif/heic/…) se aplana a JPEG:
 *   universal, acotado en memoria, y descarta alfa/animación que no podríamos
 *   marcar de forma segura.
 * - Memoria acotada (una pasada de decode+encode por request); ante cualquier
 *   fallo lanza y el endpoint fail-closea a 404.
 */
export async function watermarkImageBuffer(input: Buffer, label: string): Promise<WatermarkResult> {
  const meta = await sharp(input, { failOn: 'none', limitInputPixels: MAX_DECODE_PIXELS }).metadata()

  const orientation = typeof meta.orientation === 'number' ? meta.orientation : 1
  const swap = orientation >= 5 // 5,6,7,8 → giro de 90°/270°, se intercambian W/H
  const rawW = meta.width && meta.width > 0 ? meta.width : FALLBACK_DIM
  const rawH = meta.height && meta.height > 0 ? meta.height : FALLBACK_DIM
  const width = swap ? rawH : rawW
  const height = swap ? rawW : rawH

  const svg = Buffer.from(buildFanWatermarkSvg(width, height, label))
  const pipeline = sharp(input, { failOn: 'none', limitInputPixels: MAX_DECODE_PIXELS })
    .rotate() // respeta la orientación EXIF
    .composite([{ input: svg, top: 0, left: 0 }])

  switch (meta.format) {
    case 'png':
      return { data: await pipeline.png().toBuffer(), contentType: 'image/png' }
    case 'webp':
      return { data: await pipeline.webp().toBuffer(), contentType: 'image/webp' }
    default:
      return {
        data: await pipeline.flatten({ background: '#000000' }).jpeg({ quality: 82 }).toBuffer(),
        contentType: 'image/jpeg',
      }
  }
}
