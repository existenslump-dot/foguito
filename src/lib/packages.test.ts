// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  PACKAGES,
  PACKAGE_LIST,
  PUBLIC_PACKAGE_LIST,
  PUBLIC_DURATIONS,
  PACKAGE_TIER_SLUG,
  packageDurationDays,
  packageTierSlug,
  DEFAULT_DURATION_DAYS,
  type PackageId,
} from './packages'

/**
 * Catalogue invariants. The checkout, the activation RPC and the /planes
 * display all trust this catalogue blindly (server-authoritative pricing),
 * so drift here silently becomes wrong charges or wrong expiries.
 */
describe('billing package catalogue', () => {
  it('every package id has a tier-slug mapping (may be null, never missing)', () => {
    for (const id of Object.keys(PACKAGES)) {
      expect(PACKAGE_TIER_SLUG, `missing PACKAGE_TIER_SLUG entry for ${id}`)
        .toHaveProperty(id)
    }
  })

  it('every package carries a positive duration', () => {
    for (const pkg of PACKAGE_LIST) {
      expect(pkg.duration_days, `${pkg.id} duration`).toBeGreaterThan(0)
    }
  })

  it('every 15-day variant has a monthly sibling on the same tier', () => {
    const shortOnes = PUBLIC_PACKAGE_LIST.filter(p => p.duration_days === 15)
    expect(shortOnes.length).toBeGreaterThan(0)
    for (const pkg of shortOnes) {
      const slug = packageTierSlug(pkg.id)
      expect(slug, `${pkg.id} tier slug`).toBeTruthy()
      const monthly = PUBLIC_PACKAGE_LIST.find(
        p => p.duration_days === 30 && packageTierSlug(p.id) === slug,
      )
      expect(monthly, `${pkg.id} has no monthly sibling for tier ${slug}`).toBeTruthy()
    }
  })

  it('public prices are positive and the 15-day price undercuts its monthly sibling', () => {
    for (const pkg of PUBLIC_PACKAGE_LIST) {
      expect(pkg.price_usd, `${pkg.id} price_usd`).toBeGreaterThan(0)
      expect(pkg.price_local, `${pkg.id} price_local`).toBeGreaterThan(0)
    }
    for (const pkg of PUBLIC_PACKAGE_LIST.filter(p => p.duration_days === 15)) {
      const slug = packageTierSlug(pkg.id)
      const monthly = PUBLIC_PACKAGE_LIST.find(
        p => p.duration_days === 30 && packageTierSlug(p.id) === slug,
      )!
      expect(pkg.price_usd, `${pkg.id} should cost less than ${monthly.id}`)
        .toBeLessThan(monthly.price_usd)
    }
  })

  it('PUBLIC_DURATIONS reflects the catalogue, ascending', () => {
    expect(PUBLIC_DURATIONS).toEqual([15, 30])
  })

  it('packageDurationDays: catalogue value, or the default for unknown ids', () => {
    expect(packageDurationDays('tier_plus')).toBe(30)
    expect(packageDurationDays('tier_plus_15d')).toBe(15)
    expect(packageDurationDays('nope')).toBe(DEFAULT_DURATION_DAYS)
    expect(packageDurationDays(null)).toBe(DEFAULT_DURATION_DAYS)
  })

  it('15-day ids map to the same tier as their monthly counterpart', () => {
    const pairs: [PackageId, PackageId][] = [
      ['tier_premium', 'tier_premium_15d'],
      ['tier_plus', 'tier_plus_15d'],
      ['tier_pro', 'tier_pro_15d'],
      ['tier_max', 'tier_max_15d'],
      ['tier_elite', 'tier_elite_15d'],
    ]
    for (const [monthly, short] of pairs) {
      expect(packageTierSlug(short)).toBe(packageTierSlug(monthly))
    }
  })
})
