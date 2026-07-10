/**
 * Whitelist of path prefixes the login / register flows are allowed to
 * redirect to after auth. Anything outside this set falls back to
 * `defaultPath`.
 *
 * An explicit allowlist keeps the attack surface bounded to the pages
 * that actually make sense as a post-auth destination, and prevents
 * accidentally surfacing new routes as redirect targets just by shipping
 * them.
 */

const ALLOWED_PREFIXES = [
  '/admin',
  '/dashboard',
  '/publicar',
  '/pagos',
  '/perfil',
  '/argentina',
  '/auth',
  '/',
] as const

export function safeRedirectPath(raw: string | null | undefined, defaultPath = '/dashboard'): string {
  if (!raw) return defaultPath
  // Disallow schemes, protocol-relative, and backslash tricks outright —
  // these are the shapes that cause actual cross-origin escapes.
  if (!raw.startsWith('/')) return defaultPath
  if (raw.startsWith('//') || raw.startsWith('/\\')) return defaultPath

  // Match by prefix. Root `/` only matches when raw === '/' (so `/foo`
  // still falls through to the more specific rules).
  for (const prefix of ALLOWED_PREFIXES) {
    if (prefix === '/') {
      if (raw === '/' || raw.startsWith('/?')) return raw
      continue
    }
    if (raw === prefix || raw.startsWith(prefix + '/') || raw.startsWith(prefix + '?')) {
      return raw
    }
  }
  return defaultPath
}
