import * as Sentry from '@sentry/nextjs'
import { tagFeatureBeforeSend, tagFeatureOnBreadcrumb } from '@/lib/sentry-tags'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  // Tag events + breadcrumbs by the bracket prefix their log message
  // starts with — e.g. `console.error('[MP webhook] ...')` becomes
  // `tags.feature=mp-webhook`. See src/lib/sentry-tags.ts for the list.
  beforeSend: tagFeatureBeforeSend,
  beforeBreadcrumb: tagFeatureOnBreadcrumb,
})
