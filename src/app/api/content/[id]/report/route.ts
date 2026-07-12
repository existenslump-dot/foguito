import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { getOptionalUser } from '@/lib/clients/require-user'
import { isSameOrigin } from '@/lib/clients/same-origin'
import { getClientIp } from '@/lib/ip'
import { rateLimit } from '@/lib/rateLimit'
import { recordAudit } from '@/lib/audit'
import { ContentReportSchema, validationError } from '@/lib/validation/schemas'
import { slaDueAtForCategory } from '@/lib/moderation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/content/[id]/report
 *
 * Intake de QUEJAS sobre una pieza de contenido (PR-9). Server-authoritative y
 * anti-abuso. Espeja el intake legacy `/api/report` pero apunta a `content` +
 * `moderation_events`, y NUNCA le confirma al reporter que el contenido existe.
 *
 * ┌── INVARIANTES ─────────────────────────────────────────────────────────────┐
 * │ · same-origin (403 si no) — la queja se levanta desde nuestra UI.           │
 * │ · anon PERMITIDO — el reporter (id + IP) sale de la sesión/headers, NUNCA   │
 * │   del body (no se puede spoofear a otro usuario).                           │
 * │ · doble rate-limit: por-IP (5/h) Y por-IP-por-contenido (2/día) — corta     │
 * │   tanto el spam general como un flood dirigido a UNA pieza.                 │
 * │ · dedup: una queja `open` por (content_id, reporter_ip) — reenvíos son      │
 * │   no-op silencioso (200 igual, sin fila nueva).                            │
 * │ · SIN oráculo: MISMA respuesta genérica 200 sea nueva, deduplicada, o el    │
 * │   contenido no exista. Nunca se filtra media ni la existencia del content.  │
 * │ · NUNCA auto-takedown: la queja sólo encola; el admin decide (otra ruta).   │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    // 1. Same-origin — la queja se levanta desde nuestra propia UI.
    if (!isSameOrigin(req)) {
      return NextResponse.json({ error: 'invalid origin' }, { status: 403 })
    }

    // 2. Reporter server-side: id (si hay sesión) + IP. NUNCA del body. La clave de
    //    reporter prefiere la identidad de SESIÓN (no rotable, no colisiona tras un
    //    NAT) sobre la IP; el anon cae a IP como mejor esfuerzo.
    const reporterUserId = await getOptionalUser(req).catch(() => null)
    const ip = getClientIp(req)
    const reporterKey = reporterUserId ? `u:${reporterUserId}` : `ip:${ip}`

    // 3. content id = path param, validado como UUID (fail-closed en junk).
    const { id } = await ctx.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'id inválido (UUID esperado)' }, { status: 400 })
    }

    // 4. Rate-limit en capas:
    //    · por-IP (5/h) — corta a una IP que spamea muchas piezas (único freno del anon).
    //    · por-reporter-por-pieza (2/día) — usa la identidad de sesión si existe, así un
    //      logueado no puede floodear UNA pieza aunque rote de IP.
    //    · global-por-pieza (100/día) — backstop: acota el flood por IP rotada a UNA
    //      pieza aunque cada request traiga una IP distinta (sin este cap, rotar el
    //      X-Forwarded-For crearía filas `open` ilimitadas). No es oráculo: el contador
    //      sube por id sin mirar si el contenido existe.
    const rlIp = await rateLimit(`content-report:${ip}`, 5, 60 * 60 * 1000)
    if (!rlIp.success) {
      return NextResponse.json(
        { error: 'Demasiados reportes desde esta dirección. Probá más tarde.' },
        { status: 429, headers: { 'Retry-After': String(rlIp.retryAfter) } },
      )
    }
    const rlReporter = await rateLimit(`content-report:${reporterKey}:${id}`, 2, 24 * 60 * 60 * 1000)
    if (!rlReporter.success) {
      return NextResponse.json(
        { error: 'Ya reportaste esta pieza demasiadas veces. Probá más tarde.' },
        { status: 429, headers: { 'Retry-After': String(rlReporter.retryAfter) } },
      )
    }
    const rlContent = await rateLimit(`content-report:global:${id}`, 100, 24 * 60 * 60 * 1000)
    if (!rlContent.success) {
      return NextResponse.json(
        { error: 'Esta pieza recibió demasiados reportes hoy. Probá más tarde.' },
        { status: 429, headers: { 'Retry-After': String(rlContent.retryAfter) } },
      )
    }

    // 5. Cuerpo: sólo categoría + descripción opcional. content_id/reporter NO.
    const parsed = ContentReportSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 })
    }
    const { category, description } = parsed.data

    const admin = getSupabaseAdmin()

    // 6. Dedup por reporter: un logueado se deduplica por su user_id (identidad
    //    fuerte, no colisiona tras un NAT); el anon por IP, acotado a filas anónimas
    //    (así no lo silencia — ni silencia a — un logueado que comparta la IP). Un
    //    reenvío = no-op silencioso; respuesta genérica idéntica → sin oráculo.
    let dedup = admin
      .from('moderation_events')
      .select('id')
      .eq('content_id', id)
      .eq('status', 'open')
    dedup = reporterUserId
      ? dedup.eq('reporter_user_id', reporterUserId)
      : dedup.is('reporter_user_id', null).eq('reporter_ip', ip)
    const { data: existing } = await dedup.limit(1).maybeSingle()
    if (existing) return genericOk()

    // 7. Denormalizamos el creator_id. Si el contenido NO existe, NO insertamos
    //    (la FK lo rechazaría) y devolvemos la MISMA 200 genérica — sin confirmar
    //    existencia al reporter.
    const { data: contentRow } = await admin
      .from('content')
      .select('creator_id')
      .eq('id', id)
      .maybeSingle<{ creator_id: string | null }>()
    if (!contentRow) return genericOk()

    // 8. Insert de la queja. `sla_due_at` escalonado por categoría.
    const { error: insErr } = await admin.from('moderation_events').insert({
      content_id:       id,
      creator_id:       contentRow.creator_id,
      reporter_user_id: reporterUserId ?? null,
      reporter_ip:      ip,
      category,
      description:      description || null,
      sla_due_at:       slaDueAtForCategory(category),
    })
    if (insErr) {
      // Fail-safe SIN oráculo: un fallo de insert sólo es alcanzable para contenido
      // EXISTENTE (el camino "no existe" ya devolvió 200 antes del insert), así que un
      // 500 acá delataría existencia. Devolvemos la MISMA 200 genérica y logueamos
      // server-side; la intención del reporter no depende de enterarse del fallo.
      console.error('[content-report] insert error:', insErr)
      return genericOk()
    }

    void recordAudit({
      eventType:   'complaint_received',
      actorRole:   reporterUserId ? 'user' : 'anonymous',
      actorUserId: reporterUserId ?? null,
      subjectType: 'content',
      subjectId:   id,
      req,
      metadata:    { category, has_description: Boolean(description) },
    })

    return genericOk()
  } catch (err) {
    console.error('[content-report] route error:', err)
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 })
  }
}

/** Respuesta genérica única — misma salida para nueva/deduplicada/inexistente. */
function genericOk() {
  return NextResponse.json({ ok: true })
}
