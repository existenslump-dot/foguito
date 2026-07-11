import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { reportIncidentToNcmec } from '@/lib/csam/scan'

export const runtime = 'nodejs'

/**
 * CSAM report-retry cron — reintenta el reporte OBLIGATORIO a NCMEC.
 *
 * El reporte de un hit se persiste de forma durable en
 * `csam_incidents.ncmec_status`. Un fallo transitorio del reporte queda en
 * 'failed' (o nunca salió y quedó 'pending'). Este cron los junta y reintenta,
 * así el reporte obligatorio no se pierde ante un fallo transitorio.
 *
 * Protegido por CRON_SECRET (Bearer). Agendado cada 15 min — ver vercel.json.
 * Todo por service-role (csam_incidents es deny-all; solo service-role lee/escribe).
 */
const BATCH = 50

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  const stats = { candidates: 0, reported: 0, failed: 0 }

  const { data: incidents, error } = await admin
    .from('csam_incidents')
    .select('id, content_id, creator_id, verdict, match_type, provider, evidence_path')
    .in('ncmec_status', ['pending', 'failed'])
    .order('created_at', { ascending: true })
    .limit(BATCH)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  for (const inc of incidents ?? []) {
    stats.candidates++
    try {
      const res = await reportIncidentToNcmec(admin, {
        incidentId: inc.id as string,
        contentId: (inc.content_id as string | null) ?? null,
        creatorId: (inc.creator_id as string | null) ?? null,
        verdict: (inc.verdict as string | null) ?? 'blocked',
        matchType: (inc.match_type as string | null) ?? null,
        provider: (inc.provider as string | null) ?? 'unknown',
        evidencePath: (inc.evidence_path as string | null) ?? null,
      })
      if (res.ok) stats.reported++
      else stats.failed++
    } catch (err) {
      // reportIncidentToNcmec no debería tirar, pero por las dudas: el incidente
      // sigue reintentable en el próximo run.
      console.error(`[cron/csam-report-retry] retry failed for incident ${inc.id}:`, err)
      stats.failed++
    }
  }

  return Response.json({ success: true, stats }, { status: 200 })
}
