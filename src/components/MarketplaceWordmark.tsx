'use client'

import { MARKETPLACE } from '@/config/marketplace.config'

interface Props {
  size?: number
  minSize?: number
  className?: string
}

export default function MarketplaceWordmark({ size = 22, minSize, className = '' }: Props) {
  const responsive = typeof minSize === 'number'
  const starSize = Math.round(size * 0.35)

  return (
    <span
      className={`inline-flex items-center gap-[5px] font-medium text-[var(--v-accent)] leading-none ${className}`}
      style={{
        fontFamily: 'var(--font-serif), serif',
        fontSize: responsive ? `clamp(${minSize}px, 4.5vw, ${size}px)` : `${size}px`,
        letterSpacing: '0.18em',
      }}
    >
      {MARKETPLACE.brand.name.toUpperCase()}
      <svg
        viewBox="0 0 24 24"
        width={responsive ? '0.36em' : starSize}
        height={responsive ? '0.36em' : starSize}
        fill="currentColor"
        aria-hidden="true"
        style={{ transform: responsive ? 'translateY(-0.12em)' : `translateY(-${Math.round(size * 0.12)}px)` }}
      >
        <path d="M12 1 L13.1 10.9 L23 12 L13.1 13.1 L12 23 L10.9 13.1 L1 12 L10.9 10.9 Z" />
      </svg>
    </span>
  )
}
