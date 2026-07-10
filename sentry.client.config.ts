import * as Sentry from '@sentry/nextjs'
import { tagFeatureBeforeSend, tagFeatureOnBreadcrumb } from '@/lib/sentry-tags'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0.1,
  beforeSend: tagFeatureBeforeSend,
  beforeBreadcrumb: tagFeatureOnBreadcrumb,
})
