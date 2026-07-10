'use client'

import Spinner from './Spinner'

type Variant = 'inline' | 'block' | 'fullscreen'

interface Props {
  variant?: Variant
  size?: number
  label?: string
  ariaLabel?: string
}

export default function MarketplaceLoader({
  variant = 'inline',
  size,
  label,
  ariaLabel = 'Cargando',
}: Props) {
  const px = size ?? (variant === 'inline' ? 36 : 56)

  if (variant === 'fullscreen') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={ariaLabel}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 60,
          background: 'rgba(8,8,8,0.55)',
          backdropFilter: 'blur(2px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px',
        }}
      >
        <Spinner size={px} ariaLabel={ariaLabel} />
        {label && (
          <p
            style={{
              fontFamily: "'Montserrat',sans-serif",
              fontSize: '10px',
              fontWeight: 400,
              letterSpacing: '.26em',
              textTransform: 'uppercase',
              color: 'var(--v-accent)',
            }}
          >
            {label}
          </p>
        )}
      </div>
    )
  }

  if (variant === 'block') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={ariaLabel}
        style={{
          width: '100%',
          padding: '64px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px',
        }}
      >
        <Spinner size={px} ariaLabel={ariaLabel} />
        {label && (
          <p
            style={{
              fontFamily: "'Montserrat',sans-serif",
              fontSize: '10px',
              fontWeight: 400,
              letterSpacing: '.26em',
              textTransform: 'uppercase',
              color: 'var(--v-accent)',
            }}
          >
            {label}
          </p>
        )}
      </div>
    )
  }

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}
    >
      <Spinner size={px} ariaLabel={ariaLabel} />
      {label && (
        <span
          style={{
            fontFamily: "'Montserrat',sans-serif",
            fontSize: '9px',
            fontWeight: 400,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            color: 'var(--v-accent)',
          }}
        >
          {label}
        </span>
      )}
    </span>
  )
}
