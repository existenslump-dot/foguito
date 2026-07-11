// @vitest-environment node
/**
 * Jurisdiction matrix — exhaustive coverage of requirementFor + the key helpers.
 * The fail-closed default is the load-bearing invariant (pilar #0).
 */
import { describe, it, expect } from 'vitest'
import {
  requirementFor,
  requirementRank,
  jurisdictionKey,
  requirementForKey,
  DEFAULT_REQUIREMENT,
  US_AGE_VERIFICATION_STATES,
  EU_EEA_COUNTRIES,
} from './jurisdictions'

describe('requirementFor', () => {
  it('DEFAULT_REQUIREMENT is the strictest (fail-closed)', () => {
    expect(DEFAULT_REQUIREMENT).toBe('verify_required')
  })

  it('unlocated viewer (null/blank country) → strictest', () => {
    expect(requirementFor(null, null)).toBe('verify_required')
    expect(requirementFor(undefined, undefined)).toBe('verify_required')
    expect(requirementFor('', 'TX')).toBe('verify_required')
    expect(requirementFor('   ', null)).toBe('verify_required')
  })

  it('BR (ECA Digital) → verify_required', () => {
    expect(requirementFor('BR', null)).toBe('verify_required')
    expect(requirementFor('br', null)).toBe('verify_required')
  })

  it('UK (GB and legacy UK) → verify_required', () => {
    expect(requirementFor('GB', null)).toBe('verify_required')
    expect(requirementFor('UK', null)).toBe('verify_required')
    expect(requirementFor('gb', 'ENG')).toBe('verify_required')
  })

  it('US strict state → verify_required', () => {
    expect(requirementFor('US', 'TX')).toBe('verify_required')
    expect(requirementFor('US', 'LA')).toBe('verify_required')
    expect(requirementFor('us', 'ut')).toBe('verify_required')
  })

  it('every listed US state resolves to verify_required', () => {
    for (const st of US_AGE_VERIFICATION_STATES) {
      expect(requirementFor('US', st)).toBe('verify_required')
    }
  })

  it('there are 25+ US age-verification states', () => {
    expect(US_AGE_VERIFICATION_STATES.size).toBeGreaterThanOrEqual(25)
  })

  it('US non-strict state → age_gate', () => {
    expect(requirementFor('US', 'CA')).toBe('age_gate')
    expect(requirementFor('US', 'NY')).toBe('age_gate')
    expect(requirementFor('US', 'WA')).toBe('age_gate')
  })

  it('US with indeterminate state (null region) → strictest', () => {
    expect(requirementFor('US', null)).toBe('verify_required')
    expect(requirementFor('US', '')).toBe('verify_required')
    expect(requirementFor('US', '   ')).toBe('verify_required')
  })

  it('EU/EEA/CH → age_gate', () => {
    expect(requirementFor('DE', null)).toBe('age_gate')
    expect(requirementFor('FR', null)).toBe('age_gate')
    expect(requirementFor('ES', null)).toBe('age_gate')
    expect(requirementFor('NO', null)).toBe('age_gate') // EEA
    expect(requirementFor('CH', null)).toBe('age_gate') // Switzerland
    expect(requirementFor('MT', null)).toBe('age_gate') // Malta (country), not Montana
  })

  it('every EU/EEA country resolves to age_gate', () => {
    for (const c of EU_EEA_COUNTRIES) {
      expect(requirementFor(c, null)).toBe('age_gate')
    }
  })

  it('any other located country → strictest (fail-closed default)', () => {
    expect(requirementFor('AR', null)).toBe('verify_required')
    expect(requirementFor('MX', null)).toBe('verify_required')
    expect(requirementFor('ZZ', null)).toBe('verify_required')
  })
})

describe('requirementRank', () => {
  it('orders strictest → laxest', () => {
    expect(requirementRank('verify_required')).toBeGreaterThan(requirementRank('age_gate'))
    expect(requirementRank('age_gate')).toBeGreaterThan(requirementRank('none'))
  })
})

describe('jurisdictionKey', () => {
  it('unlocated → ZZ', () => {
    expect(jurisdictionKey(null, null)).toBe('ZZ')
    expect(jurisdictionKey('', 'TX')).toBe('ZZ')
  })

  it('US with region → US-<region>', () => {
    expect(jurisdictionKey('US', 'TX')).toBe('US-TX')
    expect(jurisdictionKey('us', 'ca')).toBe('US-CA')
  })

  it('US without region → US', () => {
    expect(jurisdictionKey('US', null)).toBe('US')
    expect(jurisdictionKey('US', '')).toBe('US')
  })

  it('other country → the country code', () => {
    expect(jurisdictionKey('BR', null)).toBe('BR')
    expect(jurisdictionKey('de', 'BY')).toBe('DE')
  })
})

describe('requirementForKey (inverse of jurisdictionKey)', () => {
  it('round-trips through jurisdictionKey', () => {
    expect(requirementForKey(jurisdictionKey('US', 'TX'))).toBe('verify_required')
    expect(requirementForKey(jurisdictionKey('US', 'CA'))).toBe('age_gate')
    expect(requirementForKey(jurisdictionKey('US', null))).toBe('verify_required')
    expect(requirementForKey(jurisdictionKey('BR', null))).toBe('verify_required')
    expect(requirementForKey(jurisdictionKey('DE', null))).toBe('age_gate')
    expect(requirementForKey(jurisdictionKey(null, null))).toBe('verify_required')
  })

  it('ZZ / empty → strictest', () => {
    expect(requirementForKey('ZZ')).toBe('verify_required')
    expect(requirementForKey('')).toBe('verify_required')
    expect(requirementForKey(null)).toBe('verify_required')
  })
})
