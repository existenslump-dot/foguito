import { createClient } from '@supabase/supabase-js'

/**
 * Check if a user (by email) has an active Elite subscription.
 *
 * An "active" subscription is one where:
 *   - status = 'active'
 *   - expires_at is in the future (or null, meaning open-ended)
 *
 * Uses the anon client intentionally — `elite_subscriptions` has a public
 * SELECT policy so the check works without elevated credentials. Writes
 * still require service_role (see migration).
 *
 * @returns true if the email has an active subscription, false otherwise.
 */
export async function checkEliteAccess(userEmail: string): Promise<boolean> {
  if (!userEmail) return false

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('elite_subscriptions')
    .select('id, expires_at, status')
    .eq('user_email', userEmail.toLowerCase().trim())
    .eq('status', 'active')
    .or(`expires_at.gte.${nowIso},expires_at.is.null`)
    .limit(1)

  if (error) {
    console.error('[checkEliteAccess] query failed:', error)
    return false
  }

  return Array.isArray(data) && data.length > 0
}
