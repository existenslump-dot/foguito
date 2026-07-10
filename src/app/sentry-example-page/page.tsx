'use client'
import * as Sentry from '@sentry/nextjs'

export default function SentryTestPage() {
  return (
    <main style={{ padding: '2rem', background: 'var(--v-bg-elevated)', minHeight: '100vh', color: '#e8dcc8' }}>
      <h1>Sentry Test</h1>
      <button
        onClick={() => {
          throw new Error('Sentry test error from Marketplace')
        }}
        style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: 'var(--v-accent)', color: 'var(--v-bg-elevated)', border: 'none', cursor: 'pointer' }}
      >
        Trigger test error
      </button>
    </main>
  )
}
