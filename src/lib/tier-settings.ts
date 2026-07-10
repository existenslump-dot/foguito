import { supabase } from '@/lib/supabase/client'
import type { TierId } from '@/lib/categories'

/**
 * Admin-controlled toggle of which tiers are publicly offered. Lives in the
 * `tier_settings` table (see migration 20260419010000). Used by:
 *   - /planes  → hide inactive columns from the public pricing table
 *   - /admin/create → hide inactive options from the tier selector
 *   - AdminTierSettings → the toggle UI itself
 *
 * Current policy: every public tier active (Elite → Basic); see migration
 * 20260702120000_activate_all_tiers. When the `tier_settings` row set is
 * empty (pre-migration or fetch failure) we fall back to that policy so the
 * UI never shows a blank table.
 */

export type TierSetting = { tier_slug: string; is_active: boolean }

/** Default: all public tiers offered. */
export const DEFAULT_ACTIVE_TIER_SLUGS: ReadonlyArray<TierId> = ['elite', 'gold', 'silver', 'bronze', 'basic']

/** Fetch the full set of rows (active + inactive) — used by admin UI. */
export async function fetchTierSettings(): Promise<TierSetting[]> {
  const { data, error } = await supabase
    .from('tier_settings')
    .select('tier_slug, is_active')
  // Log failures so a silent Supabase error doesn't masquerade as "empty
  // table → seed defaults" on the public consumers (/planes, /publicar,
  // /admin/create, /pagos). Callers that need to surface the error in
  // the UI should use `fetchTierSettingsResult` instead — this function
  // keeps the legacy "return [] on error" shape.
  if (error) console.error('[tier-settings] fetch failed', error)
  return data ?? []
}

/**
 * Admin-facing variant that returns the error alongside the rows so the
 * UI can distinguish "empty table" (seed defaults, show nothing special)
 * from "fetch failed" (show error + retry affordance). Public consumers
 * of /lib/tier-settings don't need this — they silently fall back to the
 * launch defaults via `toActiveSet(...)`.
 */
export async function fetchTierSettingsResult(): Promise<{ rows: TierSetting[]; error: Error | null }> {
  const { data, error } = await supabase
    .from('tier_settings')
    .select('tier_slug, is_active')
  if (error) {
    console.error('[tier-settings] fetch failed', error)
    return { rows: [], error: new Error(error.message) }
  }
  return { rows: data ?? [], error: null }
}

/** Convert a settings list to a Set of active slugs, with default fallback. */
export function toActiveSet(settings: TierSetting[]): Set<string> {
  if (settings.length === 0) return new Set(DEFAULT_ACTIVE_TIER_SLUGS)
  return new Set(settings.filter(s => s.is_active).map(s => s.tier_slug))
}
