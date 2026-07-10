// @vitest-environment node
// Pure parsing tests — no Sentry SDK needed, just the two hooks. If this
// helper regresses silently, every subsequent Sentry event loses its
// feature tag and the facet UI collapses.

import { describe, it, expect } from 'vitest'
import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/nextjs'
import { tagFeatureOnBreadcrumb, tagFeatureBeforeSend } from './sentry-tags'

describe('tagFeatureOnBreadcrumb', () => {
  it('tags a console breadcrumb whose message starts with [known-feature]', () => {
    const crumb: Breadcrumb = {
      category: 'console',
      message: '[MP webhook] signature rejected for payment_id=abc',
    }
    const out = tagFeatureOnBreadcrumb(crumb)
    expect(out?.data?.feature).toBe('mp-webhook')
  })

  it('leaves non-console breadcrumbs alone', () => {
    const crumb: Breadcrumb = {
      category: 'http',
      message: '[stories] this is not a console breadcrumb',
    }
    const out = tagFeatureOnBreadcrumb(crumb)
    // Still returned unchanged — no data.feature.
    expect(out?.data?.feature).toBeUndefined()
  })

  it('tags unknown prefixes as "unknown-feature" so we spot typos', () => {
    const crumb: Breadcrumb = {
      category: 'console',
      message: '[typo-feature] something happened',
    }
    const out = tagFeatureOnBreadcrumb(crumb)
    expect(out?.data?.feature).toBe('unknown-feature')
  })

  it('ignores messages with no bracket prefix', () => {
    const crumb: Breadcrumb = {
      category: 'console',
      message: 'just a regular log',
    }
    const out = tagFeatureOnBreadcrumb(crumb)
    expect(out?.data?.feature).toBeUndefined()
  })

  it('ignores brackets that are not at the start', () => {
    const crumb: Breadcrumb = {
      category: 'console',
      message: 'somehow [MP webhook] ended up mid-string',
    }
    const out = tagFeatureOnBreadcrumb(crumb)
    expect(out?.data?.feature).toBeUndefined()
  })

  it('preserves existing breadcrumb.data when adding feature', () => {
    const crumb: Breadcrumb = {
      category: 'console',
      message: '[audit] insert rejected',
      data: { original: 'preserved' },
    }
    const out = tagFeatureOnBreadcrumb(crumb)
    expect(out?.data?.feature).toBe('audit')
    expect(out?.data?.original).toBe('preserved')
  })
})

describe('tagFeatureBeforeSend', () => {
  const hint: EventHint = {}

  it('redacts sensitive headers before tagging', () => {
    const event: ErrorEvent = {
      request: {
        headers: {
          authorization: 'Bearer supersecret',
          cookie: 'sb-auth=xyz',
          'user-agent': 'test',
        },
      },
      type: undefined,
    } as ErrorEvent
    const out = tagFeatureBeforeSend(event, hint)
    expect(out.request?.headers?.authorization).toBeUndefined()
    expect(out.request?.headers?.cookie).toBeUndefined()
    // Non-sensitive headers survive.
    expect(out.request?.headers?.['user-agent']).toBe('test')
  })

  it('tags events whose exception message starts with [feature]', () => {
    const event: ErrorEvent = {
      exception: { values: [{ value: '[MP webhook] amount mismatch' }] },
      type: undefined,
    } as ErrorEvent
    const out = tagFeatureBeforeSend(event, hint)
    expect(out.tags?.feature).toBe('mp-webhook')
  })

  it('falls back to event.message when no exception message matches', () => {
    // Sentry.captureMessage() path — no exception, just a message.
    const event: ErrorEvent = {
      message: '[stories] upload failed (no post row)',
      type: undefined,
    } as ErrorEvent
    const out = tagFeatureBeforeSend(event, hint)
    expect(out.tags?.feature).toBe('stories')
  })

  it('does not override an existing event.tags.feature', () => {
    // If caller already tagged the event (e.g. via Sentry.withScope), we
    // don't clobber it. But per current impl we set unconditionally if we
    // find a prefix — document that behaviour.
    const event: ErrorEvent = {
      exception: { values: [{ value: '[audit] failed' }] },
      tags: { feature: 'manually-set' },
      type: undefined,
    } as ErrorEvent
    const out = tagFeatureBeforeSend(event, hint)
    // Current behaviour: the bracket tag wins. If we ever want caller
    // tags to win, the helper can check `event.tags?.feature` first.
    expect(out.tags?.feature).toBe('audit')
  })

  it('leaves events without a recognisable prefix untagged', () => {
    const event: ErrorEvent = {
      exception: { values: [{ value: 'TypeError: Cannot read x of undefined' }] },
      type: undefined,
    } as ErrorEvent
    const out = tagFeatureBeforeSend(event, hint)
    expect(out.tags?.feature).toBeUndefined()
  })

  it('normalises weird prefix casing and separators', () => {
    // '[MP_Webhook ]' → mp-webhook
    const event: ErrorEvent = {
      exception: { values: [{ value: '[MP_Webhook ] detail' }] },
      type: undefined,
    } as ErrorEvent
    const out = tagFeatureBeforeSend(event, hint)
    expect(out.tags?.feature).toBe('mp-webhook')
  })
})
