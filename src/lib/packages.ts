import { MARKETPLACE } from '@/config/marketplace.config'

/**
 * Server-authoritative catalogue of paid tiers.
 *
 * Anything that touches money MUST look up prices here by `package_id` —
 * never trust amounts sent in the request body. Previously the MP
 * preference endpoint accepted client-controlled amounts and would create
 * a preference for whatever value the user typed, enabling $1 payments for
 * top tiers.
 *
 * The actual numbers live in `MARKETPLACE.billing.packages`
 * (src/config/marketplace.config.ts) so a deployment edits its catalogue in
 * the same place as its brand/market settings. This module is the typed,
 * diff-reviewable accessor the payment routes consume.
 */

export type PackageId =
  | 'tier_premium'
  | 'tier_plus'
  | 'tier_pro'
  | 'tier_max'
  | 'tier_elite'
  // 15-day variants of the five tiers — same tier slug, shorter subscription.
  | 'tier_premium_15d'
  | 'tier_plus_15d'
  | 'tier_pro_15d'
  | 'tier_max_15d'
  | 'tier_elite_15d'
  // Smoke-test SKU. Admin-gated in crear-preferencia/route.ts so a regular
  // user can't trigger $1 preferences. Used to validate the full pipeline
  // (preference → checkout → webhook → activation → email) end-to-end with
  // a real card; see /admin/test-payment for the entry point.
  | 'tier_test'

/** Subscription length used when a package doesn't declare one. */
export const DEFAULT_DURATION_DAYS = 30

export interface PackageDef {
  id: PackageId
  credits: number
  price_usd: number
  /** Price in MARKETPLACE.market.currency — what MercadoPago charges. */
  price_local: number
  /** Subscription length in days (activation stamps expires_at from this). */
  duration_days: number
  label: string
  adminOnly: boolean
}

export const PACKAGES: Record<PackageId, PackageDef> = Object.fromEntries(
  MARKETPLACE.billing.packages.map((p) => [
    p.id,
    {
      id: p.id as PackageId,
      credits: p.credits,
      price_usd: p.priceUsd,
      price_local: p.priceLocal,
      duration_days: p.durationDays ?? DEFAULT_DURATION_DAYS,
      label: p.label,
      adminOnly: p.adminOnly ?? false,
    },
  ]),
) as Record<PackageId, PackageDef>

/** Ordered list for UI consumers that need the catalogue as an array. */
export const PACKAGE_LIST: PackageDef[] = Object.values(PACKAGES)

/** Public (non-admin-gated) packages — what checkout UIs should render. */
export const PUBLIC_PACKAGE_LIST: PackageDef[] = PACKAGE_LIST.filter((p) => !p.adminOnly)

/** Lookup with a narrow type guard; returns null when id is unknown. */
export function getPackage(id: string | null | undefined): PackageDef | null {
  if (!id) return null
  return (PACKAGES as Record<string, PackageDef>)[id] ?? null
}

/**
 * Checkout package id → public tier slug (as used by `tier_settings`,
 * `posts.tier` and the /planes display arrays). The package ids predate the
 * tier slugs and don't match textually (tier_premium is the BASIC tier,
 * tier_max is GOLD), so stripping the `tier_` prefix is NOT a valid mapping —
 * use this table instead. `tier_test` has no public tier.
 */
export const PACKAGE_TIER_SLUG: Record<PackageId, string | null> = {
  tier_premium: 'basic',
  tier_plus:    'bronze',
  tier_pro:     'silver',
  tier_max:     'gold',
  tier_elite:   'elite',
  tier_premium_15d: 'basic',
  tier_plus_15d:    'bronze',
  tier_pro_15d:     'silver',
  tier_max_15d:     'gold',
  tier_elite_15d:   'elite',
  tier_test:    null,
}

/** Tier slug for a package id, or null for unknown/admin-only packages. */
export function packageTierSlug(id: string | null | undefined): string | null {
  if (!id) return null
  return (PACKAGE_TIER_SLUG as Record<string, string | null>)[id] ?? null
}

/**
 * Subscription length for a package id. Falls back to DEFAULT_DURATION_DAYS
 * for unknown ids so activation never stamps a zero/NULL expiry.
 */
export function packageDurationDays(id: string | null | undefined): number {
  return getPackage(id)?.duration_days ?? DEFAULT_DURATION_DAYS
}

/** Distinct durations offered by the public catalogue, ascending (e.g. [15, 30]). */
export const PUBLIC_DURATIONS: number[] = [
  ...new Set(PUBLIC_PACKAGE_LIST.map((p) => p.duration_days)),
].sort((a, b) => a - b)
