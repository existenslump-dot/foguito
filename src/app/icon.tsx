import { ImageResponse } from 'next/og'
import { MARKETPLACE } from '@/config/marketplace.config'

// Code-generated favicon (Next.js App Router convention — auto-wired into
// <head>). Shows the brand's initial in white on the brand accent, so it
// reflects NEXT_PUBLIC_SITE_NAME / brand.colors.primary with no static asset.
export const size = { width: 64, height: 64 }
export const contentType = 'image/png'

export default function Icon() {
  const letter = (MARKETPLACE.brand.name?.trim()?.[0] ?? 'M').toUpperCase()
  const accent = MARKETPLACE.brand.colors.primary || '#2563EB'
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: accent,
          color: '#FFFFFF',
          fontSize: 42,
          fontWeight: 700,
          fontFamily: 'sans-serif',
        }}
      >
        {letter}
      </div>
    ),
    { ...size },
  )
}
