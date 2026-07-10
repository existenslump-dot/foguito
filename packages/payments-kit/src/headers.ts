import type { WebhookRequest } from './types.ts'

/** Normalize the two accepted header shapes into a lookup function. */
export function headerLookup(headers: WebhookRequest['headers']): (name: string) => string | null {
  if (typeof headers === 'function') {
    return (name) => headers(name.toLowerCase()) ?? null
  }
  const lowered: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(headers)) {
    lowered[k.toLowerCase()] = v ?? null
  }
  return (name) => lowered[name.toLowerCase()] ?? null
}
