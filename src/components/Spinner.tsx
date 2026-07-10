'use client'

/**
 * 12-dot orbital spinner — Marketplace's classic "work in progress" loader.
 *
 * Twelve accent dots arrayed around a 56×56px circle, each pulsing through
 * the cycle 0.092s after the previous one (12 × 0.092s ≈ 1.1s). The
 * staggered pulse reads as a smooth wave traveling around the orbit — the
 * classic loading pattern, in the brand accent (via the --v-accent token,
 * aliased to --brand-primary).
 *
 * Tradeoffs vs. the old pulsing logo:
 *  - More legible at small sizes (the logo monogram blurred under 60px).
 *  - Doesn't double as a brand statement.
 *
 * Pure CSS — no JS animation loop, no images. Pass `size` to scale
 * proportionally; the 12 dots reposition via translateY(-radius).
 */

interface SpinnerProps {
  /** Container side length in px. Dots scale to size/7. Default 56. */
  size?: number
  /** Override the dot fill. Defaults to the brand accent token. */
  color?: string
  /** Used by screen readers. */
  ariaLabel?: string
}

export default function Spinner({
  size = 56,
  color = 'var(--v-accent)',
  ariaLabel = 'Cargando',
}: SpinnerProps) {
  const dotSize = Math.max(4, Math.round(size / 7))
  const radius = size / 2 - dotSize / 2

  return (
    <span
      aria-hidden="true"
      data-aria-label={ariaLabel}
      style={{ width: size, height: size, position: 'relative', display: 'inline-block' }}
    >
      <style>{`
        @keyframes v-spinner-pulse {
          0%, 100% { opacity: 0.18; transform: scale(0.45); }
          50%      { opacity: 1;    transform: scale(1);    }
        }
        @media (prefers-reduced-motion: reduce) {
          .v-spinner-dot { animation: none !important; opacity: 0.6 !important; transform: scale(1) !important; }
        }
      `}</style>
      {Array.from({ length: 12 }).map((_, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: dotSize,
            height: dotSize,
            marginTop: -dotSize / 2,
            marginLeft: -dotSize / 2,
            transform: `rotate(${i * 30}deg) translateY(-${radius}px)`,
          }}
        >
          <span
            className="v-spinner-dot"
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              background: color,
              borderRadius: '50%',
              animation: `v-spinner-pulse 1.1s ease-in-out infinite`,
              animationDelay: `${-i * 0.092}s`,
            }}
          />
        </span>
      ))}
    </span>
  )
}
