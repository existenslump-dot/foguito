import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { recordAudit } from '@/lib/audit'
import { screenSubject } from '@/lib/aml'

export const runtime = 'nodejs'

/**
 * AML re-screening cron (PR-10) — re-corre el screening de sanciones periódicamente
 * para atrapar entradas NUEVAS en las listas (OFAC/UN/EU): una creadora/consumidor
 * 'clear' hoy puede volverse 'hit' mañana. Sin esto el screening sería un snapshot
 * de una sola vez.
 *
 * Cubre DOS de las tres superficies con estado persistente y refrescable:
 *   - Creadoras: `creators.sanctions_status <> 'hit'` con frescura vencida.
 *   - Consumidores PAGADORES: `profiles.consumer_sanctions_status <> 'hit'` que
 *     tienen ≥1 `foguito_orders` (no tiene sentido re-screenear a quien nunca pagó).
 * (El payout se screenea inline en cada `send`; no necesita batch.)
 *
 * Un 'hit' NO se re-screenea (ya está en el corte duro; requiere revisión manual para
 * salir). Frescura = `sanctions_screened_at` NULL o más viejo que `AML_RESCREEN_DAYS`
 * (default 30). El cutoff se computa en JS y se pasa como `.lt()` (no se interpola un
 * intervalo de `now()` de la DB). Batch acotado (50 por superficie), oldest-first.
 *
 * Protegido por CRON_SECRET (Bearer, fail-closed). Agendado diario — ver vercel.json.
 * Un throw de `screenSubject` para UN sujeto NO aborta el batch: se cuenta y se sigue.
 * NO manda email; sólo audita el run (`aml_rescreen_run`).
 */
const BATCH = 50

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

  const days = Number(process.env.AML_RESCREEN_DAYS) || 30
  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const stats = {
    creators_screened: 0,
    consumers_screened: 0,
    hits: 0,
    reviews: 0,
    failures: 0,
  }

  // ── Creadoras: status <> 'hit' + frescura vencida, oldest-first ──────────────
  const { data: creators, error: cErr } = await admin
    .from('creators')
    .select('user_id, pseudonym, country, sanctions_screened_at')
    .neq('sanctions_status', 'hit')
    .or(`sanctions_screened_at.is.null,sanctions_screened_at.lt.${cutoffIso}`)
    .order('sanctions_screened_at', { ascending: true, nullsFirst: true })
    .limit(BATCH)
  if (cErr) console.error('[aml-rescreen] creators query error', cErr)

  for (const c of creators ?? []) {
    try {
      const r = await screenSubject(admin, {
        subjectType: 'creator',
        subjectId: c.user_id as string,
        legalName: (c.pseudonym as string | null) ?? null,
        country: (c.country as string | null) ?? null,
      })
      stats.creators_screened++
      if (r.status === 'hit') stats.hits++
      else if (r.status === 'review') stats.reviews++
    } catch (e) {
      stats.failures++
      // Sin PII — sólo el id opaco.
      console.error('[aml-rescreen] creator screen failed', { subjectId: c.user_id, error: e })
    }
  }

  // ── Consumidores PAGADORES: NO 'hit' + frescura vencida, ≥1 foguito_order ────
  // El distinct+order+limit lo hace la RPC `stale_consumer_payers` EN LA DB (no hay
  // FK profiles↔foguito_orders para embeder, y materializar las órdenes app-side
  // truncaba sin orden → un pagador sancionado podía quedar fuera del slice). La RPC
  // es SECURITY DEFINER, service-role only.
  const { data: consumers, error: pErr } = await admin.rpc('stale_consumer_payers', {
    p_cutoff: cutoffIso,
    p_limit: BATCH,
  })
  if (pErr) console.error('[aml-rescreen] stale_consumer_payers rpc error', pErr)

  for (const p of (consumers ?? []) as Array<{ id: string }>) {
    try {
      const r = await screenSubject(admin, { subjectType: 'consumer', subjectId: p.id })
      stats.consumers_screened++
      if (r.status === 'hit') stats.hits++
      else if (r.status === 'review') stats.reviews++
    } catch (e) {
      stats.failures++
      console.error('[aml-rescreen] consumer screen failed', { subjectId: p.id, error: e })
    }
  }

  void recordAudit({
    eventType: 'aml_rescreen_run',
    actorRole: 'system',
    metadata: {
      creators_screened: stats.creators_screened,
      consumers_screened: stats.consumers_screened,
      hits: stats.hits,
      reviews: stats.reviews,
      failures: stats.failures,
    },
  })

  return Response.json({ success: true, stats }, { status: 200 })
}
