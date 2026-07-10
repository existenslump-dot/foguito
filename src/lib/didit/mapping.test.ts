// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  mapStatus,
  isTerminal,
  extractScores,
  extractIdVerification,
  extractDeclineReason,
} from './mapping'

describe('didit/mapping · mapStatus', () => {
  it('maps the known statuses', () => {
    expect(mapStatus('Approved')).toBe('approved')
    expect(mapStatus('Declined')).toBe('declined')
    expect(mapStatus('In Review')).toBe('in_review')
    expect(mapStatus('In Progress')).toBe('in_progress')
    expect(mapStatus('Abandoned')).toBe('abandoned')
    expect(mapStatus('Expired')).toBe('expired')
    expect(mapStatus('Not Started')).toBe('created')
    expect(mapStatus('Resubmitted')).toBe('in_progress')
  })

  it('unknown/null status falls back to in_progress (does not touch the verified flag)', () => {
    expect(mapStatus(undefined)).toBe('in_progress')
    expect(mapStatus('Whatever')).toBe('in_progress')
  })

  it('isTerminal only for approved/declined', () => {
    expect(isTerminal('approved')).toBe(true)
    expect(isTerminal('declined')).toBe(true)
    expect(isTerminal('in_review')).toBe(false)
    expect(isTerminal('in_progress')).toBe(false)
  })
})

describe('didit/mapping · extractScores', () => {
  it('reads the singular shape (face_match / liveness)', () => {
    expect(extractScores({ face_match: { score: 97.3 }, liveness: { score: 92 } }))
      .toEqual({ faceMatchScore: 97.3, livenessScore: 92 })
  })

  it('reads the array shape (face_matches[] / liveness_checks[])', () => {
    expect(
      extractScores({
        face_matches: [{ score: 80 }],
        liveness_checks: [{ score: 60 }],
      }),
    ).toEqual({ faceMatchScore: 80, livenessScore: 60 })
  })

  it('returns null when there are no scores', () => {
    expect(extractScores({})).toEqual({ faceMatchScore: null, livenessScore: null })
    expect(extractScores(null)).toEqual({ faceMatchScore: null, livenessScore: null })
  })
})

describe('didit/mapping · extractIdVerification', () => {
  it('reads singular or array', () => {
    expect(extractIdVerification({ id_verification: { first_name: 'A' } })).toEqual({ first_name: 'A' })
    expect(extractIdVerification({ id_verifications: [{ last_name: 'B' }] })).toEqual({ last_name: 'B' })
    expect(extractIdVerification({})).toBeNull()
  })
})

describe('didit/mapping · extractDeclineReason', () => {
  it('takes the first warning with a code/risk', () => {
    expect(extractDeclineReason({ warnings: [{ risk: 'FACE_MISMATCH' }] })).toBe('FACE_MISMATCH')
    expect(extractDeclineReason({ warnings: [{ code: 'DOC_EXPIRED' }] })).toBe('DOC_EXPIRED')
  })

  it('null when there are no warnings', () => {
    expect(extractDeclineReason({})).toBeNull()
    expect(extractDeclineReason({ warnings: [] })).toBeNull()
    expect(extractDeclineReason(null)).toBeNull()
  })
})
