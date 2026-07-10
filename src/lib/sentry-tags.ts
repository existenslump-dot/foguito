import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/nextjs'

/**
 * Feature-tagging shim for Sentry.
 *
 * Hardening logs use a bracketed prefix:
 *   console.error('[MP webhook] ...')
 *   console.error('[stories] insert failed', ...)
 *   console.error('[audit] logger threw', ...)
 *
 * Sentry's default parser doesn't do anything with those brackets — so
 * it's impossible to filter "show me all [MP webhook] issues in the last
 * 24h" from the UI. This helper strips a prefix like `[foo-bar]` off the
 * message and (a) drops it into `tags.feature` on the captured event so
 * Sentry projects can group/filter by it, and (b) promotes the same
 * tag onto breadcrumbs so the trail stays coherent on a single issue.
 *
 * Shared by client/server/edge Sentry init so the tagging is consistent
 * across runtimes.
 */

// Canonical list of feature tags — single source of truth for what the
// bracket prefix means. When adding a new feature log, update this list
// so Sentry's tag facet drops it as a known option instead of ballooning
// with typos/variations ('mp_webhook' vs 'mpwebhook' etc.).
const KNOWN_FEATURE_TAGS = new Set([
  'audit',
  'mp-webhook',
  'mp',
  'stories',
  'dashboard',
  'account-delete',
  'exchange-rates',
  'supabase-admin',
  'media-cleanup',
  'media',
  'reviews',
  'favorites',
  'push-subscribe',
  'register',
  'admin-backup',
  'indexnow',
])

/** Normalise "[MP webhook]" → "mp-webhook" so the tag space is small
 *  and predictable. Anything with characters outside [a-z0-9 /_-] bails
 *  out to `unknown` rather than polluting the tag dict. */
function normalisePrefix(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase().replace(/[\s/_]+/g, '-').replace(/[^a-z0-9-]/g, '')
  if (!cleaned) return null
  return cleaned
}

/** Pull "[foo] bar" → "foo", else null. Only accepts the first prefix
 *  bracketed at the start of the message — mid-string brackets are not
 *  feature tags. */
function extractFeatureTag(message: unknown): string | null {
  if (typeof message !== 'string') return null
  const match = message.match(/^\s*\[([^\]]+)\]/)
  if (!match) return null
  const normalised = normalisePrefix(match[1])
  if (!normalised) return null
  return KNOWN_FEATURE_TAGS.has(normalised) ? normalised : 'unknown-feature'
}

/**
 * beforeBreadcrumb hook — tag console breadcrumbs with a feature if the
 * message starts with `[feature]`. Pass-through for everything else.
 *
 * Returns the breadcrumb (mutation is fine — Sentry keeps the reference)
 * so callers can just `beforeBreadcrumb: tagFeatureOnBreadcrumb`.
 */
export function tagFeatureOnBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console' && typeof breadcrumb.message === 'string') {
    const tag = extractFeatureTag(breadcrumb.message)
    if (tag) {
      breadcrumb.data = { ...(breadcrumb.data ?? {}), feature: tag }
    }
  }
  return breadcrumb
}

/**
 * beforeSend composer — first strips auth headers (existing behaviour),
 * then inspects the error message for a bracket prefix and hoists it to
 * `tags.feature`. The exported function is what each sentry.*.config.ts
 * hands to Sentry.init, keeping the three configs in sync.
 */
// `_hint` is part of the Sentry beforeSend signature but we don't read
// it — kept for API compatibility with Sentry.init's type.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function tagFeatureBeforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  // 1. Redact sensitive request headers — was previously inlined in each
  //    config, now centralised so we can't forget one runtime.
  if (event.request?.headers) {
    delete event.request.headers['authorization']
    delete event.request.headers['cookie']
  }

  // 2. Pull the feature tag from the first exception's message (or the
  //    event.message fallback for `Sentry.captureMessage`). If found,
  //    attach as a tag so Sentry UI can facet on it.
  const messageSources: unknown[] = [
    event.exception?.values?.[0]?.value,
    event.message,
  ]
  for (const src of messageSources) {
    const tag = extractFeatureTag(src)
    if (tag) {
      event.tags = { ...(event.tags ?? {}), feature: tag }
      break
    }
  }

  return event
}
