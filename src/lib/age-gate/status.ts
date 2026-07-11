import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requirementForKey, requirementRank } from './jurisdictions'

/**
 * Server-authoritative age-verification state for the consumer gate (PILAR #0).
 *
 * The gate trusts ONLY the `age_gate_verifications` table — a row there is
 * written EXCLUSIVELY by the age-verify webhook (service-role) after a real
 * vendor proved the viewer is ≥18. There is no cookie/checkbox path.
 *
 * `hasValidVerification` answers: does this user hold a NON-EXPIRED verification
 * that is at least as strict as what their current jurisdiction demands?
 *
 * Compatibility ("jurisdiction o compatible"): being ≥18 is universal, but a
 * jurisdiction can demand a STRONGER regime. So a stored verification satisfies
 * the current one iff its jurisdiction's requirement rank is >= the current
 * requirement rank (a `verify_required` proof covers an `age_gate` viewer, but
 * not the reverse). Exact-key matches trivially satisfy this. Because the only
 * writer is the webhook (always a real provider proof), in practice every row
 * qualifies — the rank check just future-proofs a lighter `age_gate` method.
 *
 * FAIL-CLOSED: no user, a query error, or no qualifying row ⇒ `false`.
 */
export async function hasValidVerification(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  jurisdiction: string,
): Promise<boolean> {
  if (!userId) return false

  const requiredRank = requirementRank(requirementForKey(jurisdiction))
  const nowIso = new Date().toISOString()

  // Read own rows (RLS `agegate_select` lets a user read their own; admin all).
  // A NULL `expires_at` means "no expiry"; otherwise it must be in the future.
  const { data, error } = await supabase
    .from('age_gate_verifications')
    .select('jurisdiction, expires_at')
    .eq('user_id', userId)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)

  if (error || !data) return false // fail-closed

  return data.some(
    (row: { jurisdiction: string | null; expires_at: string | null }) =>
      requirementRank(requirementForKey(row.jurisdiction)) >= requiredRank,
  )
}
