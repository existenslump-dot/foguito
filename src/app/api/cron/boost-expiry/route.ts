import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'

export const runtime = 'nodejs'

/**
 * Clear expired boosts (daily, see vercel.json).
 *
 * The feed ordering already ignores a boost whose `boost_ends_at` is in the
 * past, so this cron is hygiene, not correctness: it flips the flag off so
 * dashboards/admin read the truthful state and future queries can filter on
 * `is_boosted` alone. Purchase history stays in `boost_purchases`.
 *
 * Runs with the service role — the `posts_guard_paid_flags` trigger only
 * lets service-side code touch the boost columns.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('posts')
    .update({ is_boosted: false, boost_ends_at: null })
    .eq('is_boosted', true)
    .lt('boost_ends_at', new Date().toISOString())
    .select('id')

  if (error) {
    console.error('[cron/boost-expiry] update failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true, cleared: data?.length ?? 0 })
}
