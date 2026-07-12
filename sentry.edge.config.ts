import * as Sentry from '@sentry/nextjs'
import { tagFeatureBeforeSend, tagFeatureOnBreadcrumb } from '@/lib/sentry-tags'
import { scrubEvent } from '@/lib/observability/scrub'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  // Componer: taggear por feature y luego scrubear PII antes de enviar.
  beforeSend: (event, hint) => scrubEvent(tagFeatureBeforeSend(event, hint)),
  beforeSendTransaction: (event) => scrubEvent(event),
  beforeBreadcrumb: tagFeatureOnBreadcrumb,
})
