import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { isSameOrigin } from '@/lib/clients/same-origin'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { getContentForDelivery } from '@/lib/content'
import { getViewerJurisdiction } from '@/lib/age-gate/viewer-geo'
import { requirementFor, jurisdictionKey } from '@/lib/age-gate/jurisdictions'
import { hasValidVerification } from '@/lib/age-gate/status'
import { watermarkImageBuffer, buildFanLabel } from '@/lib/content-watermark.server'
import { recordAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/content/[id]/media — entrega de contenido pagado a un fan (PR-5).
 *
 * ┌── ORDEN FAIL-CLOSED (cada paso deniega, nunca sirve ante duda) ─────────────┐
 * │ 1. requireUser  → sesión + same-origin (401/403). El fanId sale de la sesión │
 * │ 2. cliente RLS del fan (cookie-scoped) — es el que hace cumplir el paywall   │
 * │ 3. age-gate EXPLÍCITO — una API no hereda el layout que gatea la página, así │
 * │    que se re-chequea acá (getViewerJurisdiction → requirementFor →           │
 * │    hasValidVerification). Sin verificación válida ⇒ 403.                      │
 * │ 4. rate-limit por fan (300/h) ⇒ 429                                          │
 * │ 5. getContentForDelivery(fanClient, …) — RLS + doble guard decide el acceso; │
 * │    null ⇒ 404 (mismo 404 para no-entitled / bloqueado / inexistente: sin     │
 * │    oráculo de entitlement).                                                   │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ENTREGA por tipo de media:
 *   - image → se DESCARGAN los bytes con service-role, se tatúa la marca por-fan
 *     server-side y se streamean los bytes marcados. La URL firmada / el path
 *     privado NUNCA salen como URL: el cliente recibe bytes, no un enlace.
 *   - video/audio → el burn-in por-fan por request es demasiado caro, así que se
 *     firma una URL de vida corta (60s) y se redirige (302). Trade-off DOCUMENTADO:
 *     expone una URL firmada efímera, pero SOLO después de pasar todo el gating.
 *     La marca por-fan de video/audio se difiere a un PR de pipeline de media.
 *
 * El binario del bucket `creator-content` (deny-all RLS) sólo lo lee el
 * service-role; la decisión de acceso YA la tomó el cliente del fan (RLS) antes
 * de que el admin toque el storage. Nunca se firma/sirve con `csam_status!='pass'`
 * ni `status!='published'` (doble guard en getContentForDelivery, más allá de RLS).
 */

const CONTENT_BUCKET = 'creator-content'

// Ventana del rate-limit: 300 entregas por hora por fan (tope generoso para una
// galería con muchas piezas, pero corta el scraping masivo del catálogo).
const RL_LIMIT = 300
const RL_WINDOW_MS = 60 * 60 * 1000
// TTL de la URL firmada de video/audio: mínimo viable para arrancar la reproducción.
const SIGNED_TTL_SECONDS = 60

function notFound() {
  return NextResponse.json({ error: 'not found' }, { status: 404 })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    // 1. Same-origin (los <img>/<video> legítimos mandan Referer; un fetch
    //    cross-origin sin Origin/Referer cae a 403 — fail-closed).
    if (!isSameOrigin(req)) {
      return NextResponse.json({ error: 'invalid origin' }, { status: 403 })
    }

    // 2. Cliente RLS del fan (sólo lectura → sólo getAll de cookies). Es el que
    //    aplica el paywall en content_select; NUNCA se usa service-role acá.
    const cookieStore = await cookies()
    const fanClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } },
    )

    // fanId sale del MISMO cliente que aplica la RLS (nunca de un Bearer aparte):
    // así la identidad que decide el acceso == la que firma la marca de agua y la
    // auditoría forense. Nunca del path/body. Sin sesión ⇒ 401.
    const { data: { user: fanUser } } = await fanClient.auth.getUser()
    if (!fanUser) {
      return NextResponse.json({ error: 'not authenticated' }, { status: 401 })
    }
    const fanId = fanUser.id

    // 3. Age-gate explícito (fail-closed, como enforce.ts pero devolviendo 403).
    const viewer = getViewerJurisdiction(req.headers)
    const requirement = requirementFor(viewer.country, viewer.region)
    if (requirement !== 'none') {
      const key = jurisdictionKey(viewer.country, viewer.region)
      if (!(await hasValidVerification(fanClient, fanId, key))) {
        return NextResponse.json({ error: 'age verification required' }, { status: 403 })
      }
    }

    // 4. Rate-limit por fan.
    const rl = await rateLimit(`content-media:${fanId}`, RL_LIMIT, RL_WINDOW_MS)
    if (!rl.success) {
      return NextResponse.json(
        { error: 'rate limited' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }

    // 5. Acceso (RLS del fan + doble guard). null ⇒ 404 opaco.
    const { id } = await ctx.params
    const admin = getSupabaseAdmin()
    const row = await getContentForDelivery(fanClient, admin, id)
    if (!row) return notFound()

    // 6. Entrega según tipo de media.
    if (row.media_type === 'image') {
      const { data: blob, error } = await admin.storage
        .from(CONTENT_BUCKET)
        .download(row.media_ref)
      if (error || !blob) return notFound() // fail-closed

      let marked: { data: Buffer; contentType: string }
      try {
        const buf = Buffer.from(await blob.arrayBuffer())
        marked = await watermarkImageBuffer(buf, buildFanLabel(fanId, id))
      } catch {
        // Un fallo del tatuado NUNCA degrada a servir el original sin marca.
        return notFound()
      }

      // Auditoría forense: fan + timestamp + contenido, aunque la marca visible
      // fuese vencida. recordAudit traga sus propios errores → no bloquea la entrega.
      void recordAudit({
        eventType: 'content_delivered',
        actorRole: 'user',
        actorUserId: fanId,
        subjectType: 'content',
        subjectId: id,
        req,
        metadata: { media_type: row.media_type, visibility: row.visibility },
      })

      return new NextResponse(new Uint8Array(marked.data), {
        status: 200,
        headers: {
          'Content-Type': marked.contentType,
          'Cache-Control': 'private, no-store',
          'Content-Disposition': 'inline',
        },
      })
    }

    // video / audio → URL firmada efímera (60s) + 302. Trade-off documentado arriba.
    const { data: signed, error } = await admin.storage
      .from(CONTENT_BUCKET)
      .createSignedUrl(row.media_ref, SIGNED_TTL_SECONDS)
    if (error || !signed?.signedUrl) return notFound() // fail-closed

    void recordAudit({
      eventType: 'content_delivered',
      actorRole: 'user',
      actorUserId: fanId,
      subjectType: 'content',
      subjectId: id,
      req,
      metadata: { media_type: row.media_type, visibility: row.visibility },
    })

    const redirect = NextResponse.redirect(signed.signedUrl, 302)
    redirect.headers.set('Cache-Control', 'private, no-store')
    return redirect
  } catch {
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
}
