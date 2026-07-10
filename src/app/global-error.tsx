'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
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
    <html lang="es">
      <body style={{ background: 'var(--v-bg-base)', color: '#e8dcc8', fontFamily: "'Montserrat', sans-serif" }}>
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: 32, textAlign: 'center',
        }}>
          <div>
            <h1 style={{
              fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
              fontSize: 28, fontWeight:400, marginBottom: 16,
            }}>
              Algo sali&oacute; mal
            </h1>
            <p style={{ fontSize: 13, color: '#6a6050', marginBottom: 24 }}>
              Ha ocurrido un error inesperado.
            </p>
            <button
              onClick={reset}
              style={{
                fontSize: 10, fontWeight: 400, letterSpacing: 2,
                textTransform: 'uppercase', color: 'var(--v-accent)',
                border: '0.5px solid rgba(37, 99, 235,0.3)',
                background: 'transparent', padding: '12px 28px',
                borderRadius: 2, cursor: 'pointer',
              }}
            >
              Reintentar
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
