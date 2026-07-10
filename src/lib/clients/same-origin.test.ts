import { describe, it, expect, afterEach, vi } from 'vitest'
import { isSameOrigin } from './same-origin'

// The URL passed to `new Request()` never populates the Host header in
// undici (it's computed at dispatch time), so every test states its
// `host` / `x-forwarded-host` explicitly — same as a real inbound request
// object inside a route handler.
function post(headers: Record<string, string>): Request {
  return new Request('https://internal.invalid/api/test', { method: 'POST', headers })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isSameOrigin — production, zero config', () => {
  it('accepts a same-origin request against the deployment own host', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(
      isSameOrigin(post({ host: 'demo.vercel.app', origin: 'https://demo.vercel.app' })),
    ).toBe(true)
  })

  it('accepts when x-forwarded-host carries the public host (proxy rewrote Host)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(
      isSameOrigin(post({
        host: 'lambda-internal:3000',
        'x-forwarded-host': 'shop.example',
        origin: 'https://shop.example',
      })),
    ).toBe(true)
  })

  it('uses the first entry of a comma-separated x-forwarded-host chain', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(
      isSameOrigin(post({
        'x-forwarded-host': 'shop.example, inner-proxy.local',
        origin: 'https://shop.example',
      })),
    ).toBe(true)
  })

  it('rejects a cross-origin request', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(
      isSameOrigin(post({ host: 'shop.example', origin: 'https://evil.example' })),
    ).toBe(false)
  })

  it('rejects when neither Origin nor Referer is present', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(isSameOrigin(post({ host: 'shop.example' }))).toBe(false)
  })

  it('rejects an opaque "null" Origin (sandboxed iframe / redirect)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(isSameOrigin(post({ host: 'shop.example', origin: 'null' }))).toBe(false)
  })

  it('falls back to Referer when Origin is absent', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(
      isSameOrigin(post({ host: 'shop.example', referer: 'https://shop.example/dashboard/security' })),
    ).toBe(true)
  })
})

describe('isSameOrigin — Vercel system envs', () => {
  it('accepts the production alias via VERCEL_PROJECT_PRODUCTION_URL (bare host, no scheme)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'marketplace-demo.vercel.app')
    expect(
      isSameOrigin(post({
        host: 'iad1-internal', // upstream rewrote Host — env still matches
        origin: 'https://marketplace-demo.vercel.app',
      })),
    ).toBe(true)
  })

  it('accepts the per-deployment URL via VERCEL_URL', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_URL', 'app-abc123-team.vercel.app')
    expect(
      isSameOrigin(post({ origin: 'https://app-abc123-team.vercel.app' })),
    ).toBe(true)
  })
})

describe('isSameOrigin — NEXT_PUBLIC_APP_URL + APP_URL_ALIASES', () => {
  it('accepts the configured canonical domain even when Host differs', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.example.com')
    expect(
      isSameOrigin(post({ host: 'upstream.internal', origin: 'https://www.example.com' })),
    ).toBe(true)
  })

  it('no longer 403s the deployment own host when APP_URL is stale (the demo bug)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://old-domain.example')
    expect(
      isSameOrigin(post({
        host: 'marketplace-starter-boilerplate.vercel.app',
        origin: 'https://marketplace-starter-boilerplate.vercel.app',
      })),
    ).toBe(true)
  })

  it('tolerates a bare-domain APP_URL without scheme', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'example.com')
    expect(isSameOrigin(post({ origin: 'https://example.com' }))).toBe(true)
  })

  it('accepts extra origins from APP_URL_ALIASES and skips malformed entries', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://new.example')
    vi.stubEnv('APP_URL_ALIASES', 'https://old.example, ht!tp://bro ken,  ')
    expect(isSameOrigin(post({ origin: 'https://old.example' }))).toBe(true)
    expect(isSameOrigin(post({ origin: 'https://other.example' }))).toBe(false)
  })
})

describe('isSameOrigin — dev / test', () => {
  it('is permissive without APP_URL outside production (curl, vitest)', () => {
    // NODE_ENV is "test" under vitest; make sure no APP_URL leaks in.
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(isSameOrigin(post({}))).toBe(true)
  })

  it('accepts localhost in dev even when APP_URL points at production', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.example.com')
    expect(
      isSameOrigin(post({ host: 'localhost:3000', origin: 'http://localhost:3000' })),
    ).toBe(true)
  })
})
