import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { claimForScan, scanAndApply } from '@/lib/csam/scan'

export const runtime = 'nodejs'

/**
 * CSAM scan cron — el path AUTORITATIVO y fail-closed del pilar #0.
 *
 * Lista los drafts en `status='uploaded'`, hace un CLAIM ATÓMICO de cada uno
 * (uploaded → csam_scanning) y corre el escaneo. El claim previene doble-proceso
 * (dos ejecuciones del cron / instancias) y re-trigger. scanAndApply es
 * idempotente y fail-closed: un error deja la fila reintentable (vuelve a
 * 'uploaded') y NUNCA auto-pasa el gate CSAM.
 *
 * Protegido por CRON_SECRET (mismo patrón Bearer que los otros crons). Agendado
 * cada 2 min — ver vercel.json. Todo escribe por service-role (getSupabaseAdmin)
 * para que persista a través de content_guard_privileged.
 */
const BATCH = 25

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  const stats = { candidates: 0, claimed: 0, pass: 0, review: 0, blocked: 0, skipped: 0, failed: 0 }

  // Drafter en cola. Service-role bypassa RLS. Más viejos primero, batch acotado.
  const { data: rows, error } = await admin
    .from('content')
    .select('id')
    .eq('status', 'uploaded')
    .order('created_at', { ascending: true })
    .limit(BATCH)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  for (const row of rows ?? []) {
    stats.candidates++
    try {
      // Claim atómico: si no lo ganamos (otra instancia / ya no está 'uploaded'),
      // saltamos sin tocarlo.
      const claimed = await claimForScan(admin, row.id)
      if (!claimed) continue
      stats.claimed++

      const outcome = await scanAndApply(admin, row.id)
      if (outcome.ok) {
        stats[outcome.status]++
      } else {
        // scanAndApply ya dejó la fila reintentable (requeue a 'uploaded').
        stats.failed++
      }
    } catch (err) {
      // Red de seguridad: cualquier throw inesperado no frena el batch. La fila
      // reclamada quedará en 'csam_scanning'; el próximo run no la re-lista (solo
      // lista 'uploaded'), así que un crash duro puede dejarla huérfana — riesgo
      // de disponibilidad, NO de seguridad (fail-closed: nunca publica).
      console.error(`[cron/csam-scan] scan failed for ${row.id}:`, err)
      stats.failed++
    }
  }

  return Response.json({ success: true, stats }, { status: 200 })
}
