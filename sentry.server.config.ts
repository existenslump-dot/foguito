import * as Sentry from '@sentry/nextjs'
import { tagFeatureBeforeSend, tagFeatureOnBreadcrumb } from '@/lib/sentry-tags'
import { scrubEvent } from '@/lib/observability/scrub'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  // Tag events + breadcrumbs by the bracket prefix their log message
  // starts with — e.g. `console.error('[MP webhook] ...')` becomes
  // `tags.feature=mp-webhook`. See src/lib/sentry-tags.ts for the list.
  // Luego scrubear PII (cookies/headers/user/server_name) antes de enviar.
  beforeSend: (event, hint) => scrubEvent(tagFeatureBeforeSend(event, hint)),
  beforeSendTransaction: (event) => scrubEvent(event),
  beforeBreadcrumb: tagFeatureOnBreadcrumb,
})
