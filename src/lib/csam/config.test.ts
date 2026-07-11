// @vitest-environment node
/**
 * CSAM config — activation flag + secret getters. server-only is aliased to a
 * stub in vitest so these can run in isolation.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  isCsamEnabled,
  csamApiKey,
  csamWebhookSecret,
  ncmecApiKey,
  ncmecOrgId,
} from './config'

describe('csam/config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('isCsamEnabled requires BOTH CSAM_API_KEY and CSAM_VENDOR', () => {
    vi.stubEnv('CSAM_API_KEY', '')
    vi.stubEnv('CSAM_VENDOR', '')
    expect(isCsamEnabled()).toBe(false)

    vi.stubEnv('CSAM_API_KEY', 'k')
    vi.stubEnv('CSAM_VENDOR', '')
    expect(isCsamEnabled()).toBe(false)

    vi.stubEnv('CSAM_API_KEY', '')
    vi.stubEnv('CSAM_VENDOR', 'thorn-safer')
    expect(isCsamEnabled()).toBe(false)

    vi.stubEnv('CSAM_API_KEY', 'k')
    vi.stubEnv('CSAM_VENDOR', 'thorn-safer')
    expect(isCsamEnabled()).toBe(true)
  })

  it('getters return the env value when present', () => {
    vi.stubEnv('CSAM_API_KEY', 'api-key')
    vi.stubEnv('CSAM_WEBHOOK_SECRET', 'wh-secret')
    vi.stubEnv('NCMEC_REPORT_API_KEY', 'ncmec-key')
    vi.stubEnv('NCMEC_REPORT_ORG_ID', 'org-42')
    expect(csamApiKey()).toBe('api-key')
    expect(csamWebhookSecret()).toBe('wh-secret')
    expect(ncmecApiKey()).toBe('ncmec-key')
    expect(ncmecOrgId()).toBe('org-42')
  })

  it('getters throw when their env var is missing', () => {
    vi.stubEnv('CSAM_API_KEY', '')
    vi.stubEnv('CSAM_WEBHOOK_SECRET', '')
    vi.stubEnv('NCMEC_REPORT_API_KEY', '')
    vi.stubEnv('NCMEC_REPORT_ORG_ID', '')
    expect(() => csamApiKey()).toThrow(/CSAM_API_KEY/)
    expect(() => csamWebhookSecret()).toThrow(/CSAM_WEBHOOK_SECRET/)
    expect(() => ncmecApiKey()).toThrow(/NCMEC_REPORT_API_KEY/)
    expect(() => ncmecOrgId()).toThrow(/NCMEC_REPORT_ORG_ID/)
  })
})
