import { describe, it, expect } from 'vitest'
import { deriveAge } from './age'

// Fixed reference instant — never Date.now(). All DOBs are UTC date-only or
// full ISO so the math is deterministic regardless of the runner's timezone.
const NOW = new Date('2025-07-10T12:00:00.000Z')

describe('didit/age · deriveAge', () => {
  it('exactly 18 today → verified (ok)', () => {
    const r = deriveAge('2007-07-10', NOW)
    expect(r.age).toBe(18)
    expect(r.ageVerified).toBe(true)
    expect(r.reason).toBe('ok')
    expect(r.dob).toBe('2007-07-10')
  })

  it('one day before the 18th birthday → below_18', () => {
    const r = deriveAge('2007-07-11', NOW)
    expect(r.age).toBe(17)
    expect(r.ageVerified).toBe(false)
    expect(r.reason).toBe('below_18')
  })

  it('clearly 17 → below_18', () => {
    const r = deriveAge('2008-01-01', NOW)
    expect(r.age).toBe(17)
    expect(r.ageVerified).toBe(false)
    expect(r.reason).toBe('below_18')
  })

  it('99 → verified (no upper bound)', () => {
    const r = deriveAge('1926-01-01', NOW)
    expect(r.age).toBe(99)
    expect(r.ageVerified).toBe(true)
    expect(r.reason).toBe('ok')
  })

  it('DOB absent (undefined) → dob_missing, fail-closed', () => {
    const r = deriveAge(undefined, NOW)
    expect(r.ageVerified).toBe(false)
    expect(r.reason).toBe('dob_missing')
    expect(r.dob).toBeNull()
    expect(r.age).toBeNull()
  })

  it('DOB empty string / whitespace → dob_missing', () => {
    expect(deriveAge('', NOW).reason).toBe('dob_missing')
    expect(deriveAge('   ', NOW).reason).toBe('dob_missing')
  })

  it('DOB null → dob_missing', () => {
    const r = deriveAge(null, NOW)
    expect(r.reason).toBe('dob_missing')
    expect(r.ageVerified).toBe(false)
  })

  it('garbage DOB → dob_invalid, fail-closed', () => {
    const r = deriveAge('not-a-date', NOW)
    expect(r.ageVerified).toBe(false)
    expect(r.reason).toBe('dob_invalid')
    expect(r.age).toBeNull()
  })

  it('future DOB → dob_invalid (nonsense)', () => {
    const r = deriveAge('2030-01-01', NOW)
    expect(r.ageVerified).toBe(false)
    expect(r.reason).toBe('dob_invalid')
  })

  it('ISO DOB with a time component parses → verified', () => {
    const r = deriveAge('2000-03-20T13:45:00.000Z', NOW)
    expect(r.age).toBe(25)
    expect(r.ageVerified).toBe(true)
    expect(r.reason).toBe('ok')
  })

  describe('strict ISO parsing (fail-closed on non-ISO shapes)', () => {
    it('locale date 07/10/2007 → dob_invalid', () => {
      const r = deriveAge('07/10/2007', NOW)
      expect(r.ageVerified).toBe(false)
      expect(r.reason).toBe('dob_invalid')
    })

    it('bare year 2007 → dob_invalid', () => {
      const r = deriveAge('2007', NOW)
      expect(r.ageVerified).toBe(false)
      expect(r.reason).toBe('dob_invalid')
    })

    it('free-text "July 10, 2007" → dob_invalid', () => {
      const r = deriveAge('July 10, 2007', NOW)
      expect(r.ageVerified).toBe(false)
      expect(r.reason).toBe('dob_invalid')
    })

    it('out-of-range 2007-13-40 → dob_invalid', () => {
      const r = deriveAge('2007-13-40', NOW)
      expect(r.ageVerified).toBe(false)
      expect(r.reason).toBe('dob_invalid')
    })

    it('canonical date 2007-07-10 → valid', () => {
      const r = deriveAge('2007-07-10', NOW)
      expect(r.ageVerified).toBe(true)
      expect(r.reason).toBe('ok')
    })

    it('ISO date-time 2007-07-10T00:00:00Z → valid', () => {
      const r = deriveAge('2007-07-10T00:00:00Z', NOW)
      expect(r.ageVerified).toBe(true)
      expect(r.reason).toBe('ok')
    })
  })
})
