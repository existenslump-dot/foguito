'use client'
// Unified Marketplace logo — wraps the brand wordmark in a <Link> to "/" so
// clicking the logo from anywhere in the app returns users to the gateway.
//
// Renders the config-driven <MarketplaceWordmark /> (themeable, crisp at any
// scale). The `height` prop maps to a wordmark `size` (drives the font size)
// so call sites that constrained the logo slot keep their proportions;
// width/priority/alt are accepted for source-compat but unused.

import Link from 'next/link'
import type { CSSProperties } from 'react'
import MarketplaceWordmark from './MarketplaceWordmark'

type Props = {
  width?: number
  height?: number
  priority?: boolean
  style?: CSSProperties
  className?: string
  alt?: string
}

export default function LogoLink({
  height = 32,
  style,
  className,
}: Props) {
  // Map the old pixel height to a sensible wordmark font size.
  const size = Math.max(16, Math.round((height ?? 32) * 0.6))
  return (
    <Link
      href="/"
      aria-label="Marketplace — ir al inicio"
      style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', ...style }}
      className={className}
    >
      <MarketplaceWordmark size={size} />
    </Link>
  )
}
