import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { sendEmail, ADMIN_EMAIL } from '@/lib/clients/resend'
import { renderEmail } from '@/lib/emails'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * Moderation-SLA cron — marca las quejas VENCIDAS que siguen sin atender.
 *
 * Vencida = `status='open' AND sla_due_at < now()`. El intake escalona el SLA
 * por categoría (24h ilegal/no-consentido/CSAM · 72h DMCA · 168h spam/otro). Este
 * cron NO auto-resuelve ni auto-baja nada (el takedown es siempre admin-in-the-
 * loop) — sólo audita la brecha (`complaint_sla_breach`) y, si hay Resend, avisa
 * al admin para que triage.
 *
 * Protegido por CRON_SECRET (Bearer). Agendado cada hora — ver vercel.json.
 * `moderation_events` es deny-all: todo por service-role.
 */
const BATCH = 100

export async function GET(req: Request) {
  // Fail-closed si el secreto no está configurado: sin esto, `Bearer undefined`
  // (el template con CRON_SECRET vacío) autenticaría a cualquiera.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  const nowIso = new Date().toISOString()

  // Vencidas AÚN NO notificadas (sla_breach_notified_at IS NULL). El sello de abajo
  // evita re-auditar/re-emailear la misma queja cada hora mientras siga abierta.
  const { data: breached, error } = await admin
    .from('moderation_events')
    .select('id, content_id, category, sla_due_at, created_at')
    .eq('status', 'open')
    .lt('sla_due_at', nowIso)
    .is('sla_breach_notified_at', null)
    .order('sla_due_at', { ascending: true })
    .limit(BATCH)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const rows = breached ?? []

  for (const c of rows) {
    void recordAudit({
      eventType:   'complaint_sla_breach',
      actorRole:   'system',
      subjectType: 'content',
      subjectId:   (c.content_id as string | null) ?? null,
      metadata: {
        complaint_id: c.id,
        category:     c.category,
        sla_due_at:   c.sla_due_at,
      },
    })
  }

  // Sellar las notificadas para que la próxima corrida no las repita. Best-effort:
  // si esto fallara, en el peor caso se re-notifica (no se pierde ninguna brecha).
  if (rows.length > 0) {
    const { error: seal } = await admin
      .from('moderation_events')
      .update({ sla_breach_notified_at: nowIso })
      .in('id', rows.map((c) => c.id))
    if (seal) console.error('[moderation-sla] seal error:', seal)
  }

  // Aviso opcional al admin (best-effort — sendEmail no tira nunca; sin
  // RESEND_API_KEY es no-op silencioso).
  if (rows.length > 0 && process.env.RESEND_API_KEY) {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `Quejas con SLA vencido: ${rows.length}`,
      html: renderEmail(`
        <h2 style="color:#2563EB">SLA de moderación vencido</h2>
        <p><b>${rows.length}</b> queja(s) siguen abiertas pasado su deadline de SLA.</p>
        <p>Revisá la cola en <b>/admin</b> → Moderación de contenido.</p>
      `),
    })
  }

  return Response.json({ success: true, stats: { breached: rows.length } }, { status: 200 })
}
