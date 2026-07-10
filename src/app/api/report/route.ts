import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { getResend } from '@/lib/clients/resend'
import { ReportSchema, validationError } from '@/lib/validation/schemas'
import { renderEmail } from '@/lib/emails'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/ip'
import { recordAudit } from '@/lib/audit'
import { getOptionalUser } from '@/lib/clients/require-user'

export const runtime = 'nodejs'

const CATEGORY_LABELS: Record<string, string> = {
  spam:                  'Spam o publicación duplicada',
  estafa:                'Estafa o fraude',
  contenido_inapropiado: 'Contenido inapropiado',
  contenido_prohibido:   'Contenido prohibido o ilegal',
  otro:                  'Otro',
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req)

    // Rate limit: 10 reports per hour per IP. Reports are intentionally
    // open to anon users, but the client's 24h localStorage check is
    // trivially bypassed (cache clear / incognito / switch browser), so
    // the server caps spam before it floods the reports table or admin
    // email box.
    const rlKey = `report:${ip}`
    const { success, retryAfter } = await rateLimit(rlKey, 10, 60 * 60 * 1000)
    if (!success) {
      return NextResponse.json(
        { error: 'Demasiados reportes desde esta dirección. Probá más tarde.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      )
    }

    const supabase = getSupabaseAdmin()
    const resend = getResend()
    const parsed = ReportSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 })
    }
    const { post_id, category, description } = parsed.data

    const { data: reportRow, error: insertError } = await supabase
      .from('reports')
      .insert({ post_id, category, description: description || null, reporter_ip: ip })
      .select('id')
      .single()

    if (insertError) {
      console.error('Report insert error:', insertError)
      return NextResponse.json({ error: 'No se pudo guardar el reporte.' }, { status: 500 })
    }

    const reporterUserId = await getOptionalUser(req).catch(() => null)
    void recordAudit({
      eventType: 'report_received',
      actorRole: reporterUserId ? 'user' : 'anonymous',
      actorUserId: reporterUserId,
      subjectType: 'report',
      subjectId: reportRow?.id ?? null,
      req,
      ip,
      metadata: {
        post_id,
        category,
        has_description: Boolean(description),
      },
    })

    if (process.env.RESEND_API_KEY) {
      const html = renderEmail(`
        <h2 style="color:#2563EB;border-bottom:1px solid rgba(37, 99, 235,0.25);padding-bottom:12px;margin-bottom:20px">
          Nuevo reporte — MARKETPLACE+
        </h2>
        <p><b>Categoría:</b> ${CATEGORY_LABELS[category]}</p>
        <p><b>Post ID:</b> ${post_id}</p>
        <p><b>IP:</b> ${ip}</p>
        ${description ? `<p style="margin-top:16px"><b>Descripción:</b></p><p style="white-space:pre-wrap">${description}</p>` : ''}
      `)
      await resend.emails.send({
        from: 'MARKETPLACE+ Reportes <noreply@example.com>',
        replyTo: 'contacto@example.com',
        to: ['admin@example.com'],
        subject: `Nuevo reporte — ${CATEGORY_LABELS[category]} — Post ID: ${post_id}`,
        html,
      }).catch(e => console.error('Report email error:', e))
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Report route error:', err)
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 })
  }
}
