// @vitest-environment node
/**
 * Scrubber de PII de Sentry (PR-10). Quita cookies, headers sensibles
 * (case-insensitive), reduce `user` a `{ id }` y borra `server_name`. Nunca tira.
 */
import { describe, it, expect } from 'vitest'
import { scrubEvent } from './scrub'
import type { Event } from '@sentry/nextjs'

describe('observability/scrubEvent', () => {
  it('quita cookies + headers sensibles (case-insensitive) y conserva los seguros', () => {
    const event = {
      request: {
        cookies: { session: 'abc' },
        headers: {
          Authorization: 'Bearer secret',
          Cookie: 'sb-token=xyz',
          'X-NowPayments-Sig': 'deadbeef',
          'content-type': 'application/json',
          'user-agent': 'jest',
        },
      },
    } as unknown as Event

    const out = scrubEvent(event)
    expect(out.request).not.toHaveProperty('cookies')
    const headers = out.request!.headers as Record<string, unknown>
    expect(headers).not.toHaveProperty('Authorization')
    expect(headers).not.toHaveProperty('Cookie')
    expect(headers).not.toHaveProperty('X-NowPayments-Sig')
    // Headers no sensibles se conservan.
    expect(headers['content-type']).toBe('application/json')
    expect(headers['user-agent']).toBe('jest')
  })

  it('reduce user a { id }: fuera email / ip_address / username', () => {
    const event = {
      user: { id: 'u-1', email: 'a@b.com', ip_address: '1.2.3.4', username: 'ada' },
    } as unknown as Event

    const out = scrubEvent(event)
    expect(out.user).toEqual({ id: 'u-1' })
  })

  it('borra server_name', () => {
    const event = { server_name: 'ip-10-0-0-1' } as unknown as Event
    const out = scrubEvent(event)
    expect(out.server_name).toBeUndefined()
  })

  it('borra request.data + request.query_string (body/query crudos)', () => {
    const event = {
      request: {
        data: { password: 'hunter2', card: '4111...' },
        query_string: 'token=abc&email=a@b.com',
        headers: { 'x-safe': '1' },
      },
    } as unknown as Event
    const out = scrubEvent(event)
    expect(out.request).not.toHaveProperty('data')
    expect(out.request).not.toHaveProperty('query_string')
    expect((out.request!.headers as Record<string, unknown>)['x-safe']).toBe('1')
  })

  it('borra el data de cada breadcrumb (posible PII de logs previos), conserva message/level', () => {
    const event = {
      breadcrumbs: [
        { category: 'console', level: 'error', message: '[x] boom', data: { email: 'a@b.com' } },
        { category: 'fetch', data: { url: 'https://x/?token=abc' } },
      ],
    } as unknown as Event
    const out = scrubEvent(event)
    const crumbs = out.breadcrumbs as Array<Record<string, unknown>>
    expect(crumbs[0]).not.toHaveProperty('data')
    expect(crumbs[0].message).toBe('[x] boom')
    expect(crumbs[0].level).toBe('error')
    expect(crumbs[1]).not.toHaveProperty('data')
  })

  it('no tira con un evento vacío / parcial', () => {
    expect(() => scrubEvent({} as Event)).not.toThrow()
    expect(() => scrubEvent({ request: {} } as unknown as Event)).not.toThrow()
    expect(() => scrubEvent({ user: null } as unknown as Event)).not.toThrow()
    // Sin cookies ni user: pasa limpio.
    const out = scrubEvent({ request: { headers: { 'x-safe': '1' } } } as unknown as Event)
    expect((out.request!.headers as Record<string, unknown>)['x-safe']).toBe('1')
  })

  it('devuelve el mismo objeto (mutación in-place), tipado preservado', () => {
    const event = { server_name: 'x', extra: { keep: true } } as unknown as Event
    const out = scrubEvent(event)
    expect(out).toBe(event)
    expect(out.extra).toEqual({ keep: true })
  })
})
