// @vitest-environment node
/**
 * NCMEC reporter — stub is deterministic + no network; factory picks the real
 * reporter only when NCMEC_REPORT_API_KEY is present; the real skeleton is
 * fail-closed (report throws until implemented).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  NcmecReporterStub,
  NcmecReporterHttp,
  getNcmecReporter,
  isNcmecConfigured,
  type NcmecIncident,
} from './ncmec'

const incident: NcmecIncident = {
  incidentId: 'inc-123',
  contentId: 'content-1',
  creatorId: 'creator-1',
  verdict: 'blocked',
  matchType: 'known_hash',
  provider: 'stub',
  evidencePath: 'creator-1/content-1/media',
}

describe('csam/ncmec', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('stub reports ok with a deterministic fake reportId (no network)', async () => {
    const r = await new NcmecReporterStub().report(incident)
    expect(r).toEqual({ ok: true, reportId: 'STUB-NCMEC-inc-123' })
  })

  it('isNcmecConfigured tracks NCMEC_REPORT_API_KEY', () => {
    vi.stubEnv('NCMEC_REPORT_API_KEY', '')
    expect(isNcmecConfigured()).toBe(false)
    vi.stubEnv('NCMEC_REPORT_API_KEY', 'k')
    expect(isNcmecConfigured()).toBe(true)
  })

  it('getNcmecReporter returns the stub when unconfigured', () => {
    vi.stubEnv('NCMEC_REPORT_API_KEY', '')
    expect(getNcmecReporter()).toBeInstanceOf(NcmecReporterStub)
  })

  it('getNcmecReporter returns the real reporter when configured', () => {
    vi.stubEnv('NCMEC_REPORT_API_KEY', 'k')
    expect(getNcmecReporter()).toBeInstanceOf(NcmecReporterHttp)
  })

  it('the real reporter skeleton is fail-closed: report throws (not implemented)', async () => {
    await expect(new NcmecReporterHttp().report(incident)).rejects.toThrow(/not implemented/)
  })

  it('FAIL-CLOSED en producción: el stub devuelve ok:false (no da por enviado un reporte)', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    const r = await new NcmecReporterStub().report(incident)
    expect(r.ok).toBe(false)
    expect(r.reportId).toBeUndefined()
    vi.unstubAllEnvs()
  })
})
