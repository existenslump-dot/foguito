import { ImageResponse } from 'next/og'
import { MARKETPLACE } from '@/config/marketplace.config'

// Code-generated Apple touch icon (Next.js App Router convention). Same brand
// initial mark as the favicon — no static asset.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
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
          fontSize: 120,
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
