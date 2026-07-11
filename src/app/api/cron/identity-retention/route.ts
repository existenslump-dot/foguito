import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { purgeIdentityDocuments, purgeAgeGateVerifications } from '@/lib/identity-retention'

export const runtime = 'nodejs'

/**
 * Identity-document retention cron.
 *
 * Finds closed accounts whose retention window has elapsed
 * (`identity_purge_after <= now()` and not yet purged), wipes the user's
 * `identity-documents/{userId}/` folder, and stamps `identity_purged_at`.
 *
 * Protected by CRON_SECRET (same Bearer pattern as the other crons). Scheduled
 * daily — see vercel.json.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const nowIso = new Date().toISOString()
  const stats = { eligible: 0, purged: 0, filesRemoved: 0, failed: 0 }

  // Due, not-yet-purged rows. Service-role bypasses RLS.
  const { data: rows, error } = await supabase
    .from('deletion_log')
    .select('id, user_id')
    .lte('identity_purge_after', nowIso)
    .is('identity_purged_at', null)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  for (const row of rows ?? []) {
    if (!row.user_id) continue
    stats.eligible++
    try {
      const { removed } = await purgeIdentityDocuments(supabase, row.user_id)
      // Also purge the fan's age-gate verifications (PII minimization). Only
      // method/jurisdiction/timing live there, but it's account-linked data and
      // shouldn't outlive the account past its retention window.
      await purgeAgeGateVerifications(supabase, row.user_id)
      await supabase
        .from('deletion_log')
        .update({ identity_purged_at: new Date().toISOString() })
        .eq('id', row.id)
      stats.purged++
      stats.filesRemoved += removed
    } catch (err) {
      // Leave identity_purged_at NULL so the next run retries this user.
      console.error(`[cron/identity-retention] purge failed for ${row.user_id}:`, err)
      stats.failed++
    }
  }

  return Response.json({ success: true, stats }, { status: 200 })
}
