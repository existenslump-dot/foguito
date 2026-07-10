// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSession, getDecision } from './client'
import { isDiditEnabled } from './config'

function mockFetchOnce(status: number, body: unknown) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
  // fetch-like signature so `.mock.calls[0]` types as [input, init?] not [].
  return vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(res),
  )
}

describe('didit/config · isDiditEnabled', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('false without credentials', () => {
    vi.stubEnv('DIDIT_API_KEY', '')
    vi.stubEnv('DIDIT_WORKFLOW_ID', '')
    expect(isDiditEnabled()).toBe(false)
  })

  it('false if the workflow is missing', () => {
    vi.stubEnv('DIDIT_API_KEY', 'k')
    vi.stubEnv('DIDIT_WORKFLOW_ID', '')
    expect(isDiditEnabled()).toBe(false)
  })

  it('true with both', () => {
    vi.stubEnv('DIDIT_API_KEY', 'k')
    vi.stubEnv('DIDIT_WORKFLOW_ID', 'wf')
    expect(isDiditEnabled()).toBe(true)
  })
})

describe('didit/client · createSession', () => {
  beforeEach(() => {
    vi.stubEnv('DIDIT_API_KEY', 'test-key')
    vi.stubEnv('DIDIT_WORKFLOW_ID', 'wf-123')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('posts with x-api-key + workflow_id and returns the session', async () => {
    const fetchMock = mockFetchOnce(201, {
      session_id: 's1',
      url: 'https://verify.didit.me/session/abc',
      status: 'Not Started',
      workflow_id: 'wf-123',
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await createSession({ vendorData: 'user-1', callback: 'https://app/cb' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.url).toContain('verify.didit.me')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://verification.didit.me/v3/session/')
    expect((init as RequestInit).method).toBe('POST')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['x-api-key']).toBe('test-key')
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent.workflow_id).toBe('wf-123')
    expect(sent.vendor_data).toBe('user-1')
    expect(sent.language).toBe('en')
    expect(sent.callback).toBe('https://app/cb')
  })

  it('forwards an explicit language', async () => {
    const fetchMock = mockFetchOnce(201, {
      session_id: 's1',
      url: 'https://verify.didit.me/session/abc',
      status: 'Not Started',
      workflow_id: 'wf-123',
    })
    vi.stubGlobal('fetch', fetchMock)

    await createSession({ vendorData: 'user-1', language: 'es' })
    const [, init] = fetchMock.mock.calls[0]
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent.language).toBe('es')
  })

  it('returns an error on a non-OK response', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(401, { message: 'bad key' }))
    const r = await createSession({ vendorData: 'user-1' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('bad key')
      expect(r.status).toBe(401)
    }
  })

  it('returns an error if the response is missing session_id/url', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(201, { status: 'Not Started' }))
    const r = await createSession({ vendorData: 'user-1' })
    expect(r.ok).toBe(false)
  })

  it('catches network errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    const r = await createSession({ vendorData: 'user-1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('ECONNRESET')
  })
})

describe('didit/client · getDecision', () => {
  beforeEach(() => {
    vi.stubEnv('DIDIT_API_KEY', 'test-key')
    vi.stubEnv('DIDIT_WORKFLOW_ID', 'wf-123')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('GETs the decision with the id encoded', async () => {
    const fetchMock = mockFetchOnce(200, { session_id: 's1', status: 'Approved' })
    vi.stubGlobal('fetch', fetchMock)

    const r = await getDecision('s 1/x')
    expect(r.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://verification.didit.me/v3/session/s%201%2Fx/decision/')
    expect((init as RequestInit).method).toBe('GET')
  })

  it('error on non-OK', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(404, { error: 'not found' }))
    const r = await getDecision('s1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })
})
