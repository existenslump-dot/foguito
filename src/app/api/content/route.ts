import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireUser } from '@/lib/clients/require-user'
import { getCreatorVerification, isPublishEligible } from '@/lib/creators'
import {
  createContentDraft,
  getSelfPerformerId,
  linkPerformer,
  type MediaType,
  type Visibility,
} from '@/lib/content'
import sharp from 'sharp'
import { ALLOWED_IMAGE_MIME, ALLOWED_VIDEO_MIME } from '@/lib/upload-validation'
import { MAX_IMAGE_SIZE, MAX_STORY_VIDEO_SIZE } from '@/lib/media-limits'
import { TIERS } from '@/lib/categories'
import { recordAudit } from '@/lib/audit'
import { sniffMediaCategory } from '@/lib/media-sniff'
import { isCsamEnabled } from '@/lib/csam/config'
import { claimForScan, scanAndApply } from '@/lib/csam/scan'

export const runtime = 'nodejs'

// Techo de píxeles para imágenes de contenido (~100 MP). Una foto legítima de
// alta resolución queda holgada; corta las bombas de descompresión (~256 MP en
// menos de 20 MB) que OOMearían la función de entrega en CADA vista del fan.
const MAX_IMAGE_PIXELS = 100_000_000

/**
 * POST /api/content — creator-facing content creation (the WRITE side, PR-3(A)).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ INVARIANTE: creating content is SERVER-AUTHORITATIVE — there is NO          │
 * │ client-side `from('content').insert(...)`. If the creator could insert      │
 * │ directly she'd set media_ref / status / visibility arbitrarily and bypass   │
 * │ the private bucket entirely. This route is the only door: it binds          │
 * │ creator_id to the SESSION (never the body), uploads the media to the        │
 * │ PRIVATE `creator-content` bucket via service-role, and lands a DRAFT        │
 * │ (`status='uploaded'`, `csam_status='pending'`).                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Nothing here publishes. content_publish_guard (DB) stays the authority — a
 * draft can only go live once CSAM passes (PR-3) AND an admin publishes (PR-3
 * moderation), with a complete 2257 record for every performer. Signed delivery
 * to paying fans + watermark are PR-5; entitlements/pagos are PR-6+.
 */

// Reuse the shared upload whitelists (image + video only in this PR — audio is a
// later media_type). ext is derived from the VALIDATED mime, never the filename.
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
}

const VISIBILITIES = new Set<Visibility>(['free_preview', 'tier', 'ppv'])
const TIER_SLUGS = new Set<string>(TIERS.map((t) => t.id))
const MAX_TITLE = 200
const MAX_CAPTION = 2000
const CONTENT_BUCKET = 'creator-content'

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest) {
  try {
    // 1. Session user — creatorId is bound to the session, NEVER the body.
    const gate = await requireUser(req)
    if (!gate.ok) return gate.response
    const creatorId = gate.userId

    const admin = getSupabaseAdmin()

    // 2. Publish-eligibility gate (defense-in-depth UX; the DB guard is the
    //    real authority). A non-verified 18+ creator can't create content.
    const verification = await getCreatorVerification(admin, creatorId)
    if (!isPublishEligible(verification)) {
      return err('Verificá tu identidad 18+ antes de subir contenido.', 403)
    }

    const form = await req.formData()

    // 3. Metadata + media validation.
    const title = String(form.get('title') ?? '').trim().slice(0, MAX_TITLE) || null
    const caption = String(form.get('caption') ?? '').trim().slice(0, MAX_CAPTION) || null

    const visibilityRaw = String(form.get('visibility') ?? '').trim() as Visibility
    if (!VISIBILITIES.has(visibilityRaw)) {
      return err('visibility inválida (free_preview | tier | ppv)')
    }
    const visibility: Visibility = visibilityRaw

    // Coherence between visibility and its pricing field.
    let requiredTier: string | null = null
    let ppvPriceCredits: number | null = null
    if (visibility === 'tier') {
      requiredTier = String(form.get('required_tier') ?? '').trim()
      if (!TIER_SLUGS.has(requiredTier)) {
        return err(`required_tier inválido para visibility=tier (${[...TIER_SLUGS].join(', ')})`)
      }
    } else if (visibility === 'ppv') {
      const raw = String(form.get('ppv_price_credits') ?? '').trim()
      const n = Number(raw)
      if (!Number.isInteger(n) || n <= 0) {
        return err('ppv_price_credits debe ser un entero positivo para visibility=ppv')
      }
      ppvPriceCredits = n
    }

    const media = form.get('media') as File | null
    if (!media) return err('Falta el archivo de contenido (media)')

    // Categoría DECLARADA por el MIME multipart (atacable). Se confirma abajo
    // contra los bytes reales antes de confiar en ella para nada de seguridad.
    const declaredCategory: MediaType | null = ALLOWED_IMAGE_MIME.has(media.type)
      ? 'image'
      : ALLOWED_VIDEO_MIME.has(media.type)
        ? 'video'
        : null
    if (!declaredCategory) {
      return err(`media: tipo no permitido (${media.type || 'desconocido'}). Usá imagen o video.`)
    }
    if (declaredCategory === 'image' && media.size > MAX_IMAGE_SIZE) {
      return err(`media: la imagen excede ${MAX_IMAGE_SIZE / 1024 / 1024} MB`)
    }
    if (declaredCategory === 'video' && media.size > MAX_STORY_VIDEO_SIZE) {
      return err(`media: el video excede ${MAX_STORY_VIDEO_SIZE / 1024 / 1024} MB`)
    }

    // ── media_type AUTORITATIVO: sniff de magic-bytes, NO el MIME declarado ──────
    // Sin esto un JPEG declarado `video/mp4` se serviría por la rama de video del
    // endpoint de entrega SIN marca de agua por-fan → leak no trazable (rompe la
    // única razón de ser de la marca). Se leen sólo los primeros KB: barato y sin
    // cargar el archivo entero (clave para video).
    const headBytes = new Uint8Array(await media.slice(0, 4096).arrayBuffer())
    const sniffed = sniffMediaCategory(headBytes)
    if (sniffed !== declaredCategory) {
      return err(
        `media: el contenido no coincide con el tipo declarado (declarado ${declaredCategory}, real ${sniffed}).`,
      )
    }
    const mediaType: MediaType = declaredCategory

    // Para imágenes: confirmar que sean DECODIFICABLES por sharp (un HEIC que este
    // build no soporte entregaría 404 para siempre → mejor rechazarlo en el alta)
    // y ACOTAR los píxeles (bomba de descompresión). metadata() lee el header, no
    // decodifica el raster completo, así que las dimensiones salen sin costo alto.
    if (mediaType === 'image') {
      try {
        const meta = await sharp(Buffer.from(await media.arrayBuffer()), {
          failOn: 'none',
          limitInputPixels: MAX_IMAGE_PIXELS,
        }).metadata()
        if (!meta.width || !meta.height || meta.width * meta.height > MAX_IMAGE_PIXELS) {
          return err('media: imagen de dimensiones no válidas o demasiado grande.')
        }
      } catch {
        return err('media: formato de imagen no soportado o archivo corrupto.')
      }
    }

    // 4. Fail-closed BEFORE uploading: without a certified self 2257 record the
    //    draft could never publish anyway (content_publish_guard), so we don't
    //    even want an orphan object in the private bucket. (Moved ahead of the
    //    upload vs. the raw step order — strictly safer, no orphan media.)
    const selfPerformerId = await getSelfPerformerId(admin, creatorId)
    if (!selfPerformerId) {
      return err('Verificá tu identidad 18+ primero (registro 2257 de la creadora).', 409)
    }

    // 5. Upload to the PRIVATE bucket via service-role. media_ref = the PATH
    //    (not a URL). ext from the validated mime, never the client filename.
    const ext = MIME_EXT[media.type] ?? 'bin'
    const mediaRef = `${creatorId}/${randomUUID()}/media.${ext}`
    const up = await admin.storage
      .from(CONTENT_BUCKET)
      .upload(mediaRef, media, { upsert: false, contentType: media.type })
    if (up.error) return err(`Storage upload failed: ${up.error.message}`, 500)

    // 6. Create the DRAFT (status='uploaded') and link the creator's 2257 self
    //    performer. On any failure after the upload, roll back the orphan media
    //    (and the draft row) — server-side, so nothing dangles in the bucket.
    const created = await createContentDraft(admin, {
      creatorId,
      title,
      caption,
      mediaRef,
      mediaType,
      visibility,
      requiredTier,
      ppvPriceCredits,
    })
    if (!created.ok) {
      await admin.storage.from(CONTENT_BUCKET).remove([mediaRef])
      return err(created.error, 500)
    }

    const linked = await linkPerformer(admin, created.id, selfPerformerId)
    if (!linked.ok) {
      await admin.from('content').delete().eq('id', created.id)
      await admin.storage.from(CONTENT_BUCKET).remove([mediaRef])
      return err(`No se pudo vincular el registro 2257: ${linked.error}`, 500)
    }

    void recordAudit({
      eventType: 'content_created',
      actorRole: 'user',
      actorUserId: creatorId,
      subjectType: 'content',
      subjectId: created.id,
      req,
      metadata: { visibility, media_type: mediaType },
    })

    // 7. CSAM scan. The cron (/api/cron/csam-scan) is the AUTHORITATIVE,
    //    fail-closed path (claim + retry). Here we best-effort scan INLINE only
    //    when a real vendor isn't configured (stub/dev) so a draft gets a verdict
    //    immediately. Any failure is NON-FATAL: scanAndApply requeues the row to
    //    'uploaded' and the cron re-scans it. We NEVER publish here — a 'pass'
    //    only advances the draft to 'in_review'; a hit blocks + preserves +
    //    reports inline. When the real vendor IS enabled we defer to the cron.
    if (!isCsamEnabled()) {
      try {
        if (await claimForScan(admin, created.id)) {
          await scanAndApply(admin, created.id)
        }
      } catch (e) {
        console.error('[api/content] inline CSAM scan failed (cron will retry):', e)
      }
    }

    return NextResponse.json({ id: created.id, media_ref: mediaRef })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error desconocido' },
      { status: 500 },
    )
  }
}
