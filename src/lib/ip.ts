/**
 * Centralised client IP extraction.
 *
 * Vercel's edge proxy forwards the real client IP via `x-forwarded-for`
 * (may be a comma-separated chain — the first entry is the original
 * client). Some deployments / dev proxies use `x-real-ip` instead.
 *
 * Always returns a string — falls back to `'unknown'` so callers can
 * build stable rate-limit keys without null-handling every call site.
 */
export function getClientIp(req: Request | { headers: Headers }): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}
