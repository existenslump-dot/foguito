import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_DURATION_DAYS } from '@/lib/packages'

/**
 * Subscription lookups shared by post publication paths.
 *
 * A published post's feed lifetime follows the subscription its owner
 * bought (15 or 30 days — `user_subscriptions.duration_days`, stamped by
 * `apply_payment_activation`). Both publication paths resolve it here:
 *
 *   - /api/admin/approve-post (server, admin client)
 *   - PostCreateForm admin mode (browser client — RLS lets admins read any
 *     user's subscriptions, so the same query works client-side)
 *
 * Fail-open by design: no active subscription, RLS miss or query error all
 * fall back to DEFAULT_DURATION_DAYS. Publication must never be blocked by
 * a subscription lookup — worst case a post gets the default 30 days.
 */

export interface ActiveSubscription {
  duration_days: number
  tier: string | null
  expires_at: string
}

/** Latest still-valid subscription for a user, or null. */
export async function getActiveSubscription(
  client: SupabaseClient,
  userId: string | null | undefined,
): Promise<ActiveSubscription | null> {
  if (!userId) return null
  try {
    const { data, error } = await client
      .from('user_subscriptions')
      .select('duration_days, tier, expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    return data as ActiveSubscription
  } catch {
    return null
  }
}

/**
 * Days a newly published post should live, based on the owner's active
 * subscription. DEFAULT_DURATION_DAYS when there is none.
 */
export async function resolvePostDurationDays(
  client: SupabaseClient,
  userId: string | null | undefined,
): Promise<number> {
  const sub = await getActiveSubscription(client, userId)
  const days = sub?.duration_days
  return typeof days === 'number' && days > 0 ? days : DEFAULT_DURATION_DAYS
}
