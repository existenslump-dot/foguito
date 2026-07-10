// @vitest-environment node
// Table tests for the post-auth redirect whitelist. If someone relaxes the
// rules here, crafted /login?redirect=… links can drop users on arbitrary
// internal pages (or, if the protocol check breaks, off-site).

import { describe, it, expect } from 'vitest'
import { safeRedirectPath } from './safe-redirect'

describe('safeRedirectPath', () => {
  describe('falls back to default for off-origin escapes', () => {
    const attacks = [
      '//evil.com',
      '//evil.com/path',
      'http://evil.com',
      'https://evil.com/something',
      'javascript:alert(1)',
      'data:text/html,<script>',
      '/\\evil.com',
      'mailto:attacker@evil.com',
      '',
      null,
      undefined,
    ]
    for (const input of attacks) {
      it(`rejects ${JSON.stringify(input)}`, () => {
        expect(safeRedirectPath(input)).toBe('/dashboard')
      })
    }
  })

  describe('falls back for internal paths not on the whitelist', () => {
    const offList = [
      '/blocked',
      '/login',
      '/register',
      '/ingresar',
      '/registro',
      '/recuperar',
      '/api/admin/backup',
      '/some-random-page',
      '/terminos',
      '/chile',
      '/brasil',
    ]
    for (const path of offList) {
      it(`rejects ${path}`, () => {
        expect(safeRedirectPath(path)).toBe('/dashboard')
      })
    }
  })

  describe('accepts valid whitelisted prefixes', () => {
    const ok: [string, string][] = [
      ['/admin', '/admin'],
      ['/admin/create', '/admin/create'],
      ['/admin/edit/123', '/admin/edit/123'],
      ['/dashboard', '/dashboard'],
      ['/dashboard/profile', '/dashboard/profile'],
      ['/publicar', '/publicar'],
      ['/pagos', '/pagos'],
      ['/pagos?tier=gold', '/pagos?tier=gold'],
      ['/perfil/ana', '/perfil/ana'],
      ['/argentina', '/argentina'],
      ['/argentina/capital-federal', '/argentina/capital-federal'],
      ['/auth/actualizar-password', '/auth/actualizar-password'],
      ['/', '/'],
    ]
    for (const [input, expected] of ok) {
      it(`accepts ${input}`, () => {
        expect(safeRedirectPath(input)).toBe(expected)
      })
    }
  })

  describe('custom default', () => {
    it('uses provided default when input is invalid', () => {
      expect(safeRedirectPath('//evil.com', '/')).toBe('/')
    })
    it('uses provided default when input is null', () => {
      expect(safeRedirectPath(null, '/publicar')).toBe('/publicar')
    })
  })

  describe('prefix boundary checks', () => {
    it('rejects paths that share a prefix with a whitelisted segment but differ', () => {
      // "/administracion" should NOT match "/admin" — the whitelist is
      // prefix-based but requires the next char to be `/`, `?`, or EOL.
      expect(safeRedirectPath('/administracion')).toBe('/dashboard')
      expect(safeRedirectPath('/dashboardx')).toBe('/dashboard')
    })
    it('only matches root / for the exact root or querystring, not any slash-leading path', () => {
      // The trailing `/` rule is special-cased to avoid gobbling everything.
      expect(safeRedirectPath('/foo')).toBe('/dashboard')
    })
  })
})
