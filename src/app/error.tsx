'use client'

import * as Sentry from '@sentry/nextjs'
import Link from 'next/link'
import { useEffect } from 'react'

/**
 * Route-level error boundary.
 *
 * Next.js App Router convention: any uncaught error rendered inside
 * app/**, except the root layout, hits this boundary before falling
 * through to global-error.tsx. It keeps the site chrome (nav, footer
 * via layout.tsx) alive — only the failed segment gets replaced —
 * so a bug in one page doesn't blank the whole app.
 *
 * Reports to Sentry on mount and offers the user two paths: retry the
 * same route (`reset()`) or go home. The button styling mirrors the
 * global-error boundary for visual consistency.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div
      style={{
        minHeight: '70vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        textAlign: 'center',
        background: 'var(--v-bg-base)',
        color: '#e8dcc8',
        fontFamily: "'Montserrat', sans-serif",
      }}
    >
      <div style={{ maxWidth: 440 }}>
        <h1
          style={{
            fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
            fontSize: 28,
            fontWeight: 400,
            marginBottom: 16,
            color: 'var(--v-accent)',
          }}
        >
          Algo salió mal
        </h1>
        <p style={{ fontSize: 13, color: '#6a6050', marginBottom: 8, lineHeight: 1.6 }}>
          No pudimos cargar esta sección. El equipo ya recibió el reporte.
        </p>
        {error.digest && (
          <p style={{ fontSize: 10, color: '#554a3a', marginBottom: 24, letterSpacing: '.1em' }}>
            ref: <code>{error.digest}</code>
          </p>
        )}
        <div style={{ display: 'inline-flex', gap: 10, marginTop: 16 }}>
          <button
            onClick={reset}
            style={{
              fontSize: 10,
              fontWeight: 400,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: 'var(--v-bg-base)',
              background: 'var(--v-accent)',
              border: 'none',
              padding: '12px 28px',
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
          <Link
            href="/"
            style={{
              fontSize: 10,
              fontWeight: 400,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: 'var(--v-accent)',
              border: '0.5px solid rgba(37, 99, 235,0.3)',
              background: 'transparent',
              padding: '12px 28px',
              borderRadius: 2,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Inicio
          </Link>
        </div>
      </div>
    </div>
  )
}
