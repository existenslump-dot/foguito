import { ImageResponse } from 'next/og'
import { MARKETPLACE } from '@/config/marketplace.config'

// Default link-share preview (Next.js App Router convention — auto-used for
// openGraph + twitter images on routes without their own). Code-generated,
// brand-neutral: the configured brand name on white with the accent. No
// static share image.
export const runtime = 'edge'
export const alt = 'Marketplace'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OgImage() {
  const name = (MARKETPLACE.brand.name || 'Marketplace').toUpperCase()
  const accent = MARKETPLACE.brand.colors.primary || '#2563EB'
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FFFFFF',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            fontSize: 92,
            fontWeight: 700,
            letterSpacing: 6,
            color: '#0F172A',
            fontFamily: 'serif',
          }}
        >
          {name}
          <span style={{ color: accent, fontSize: 64 }}>✦</span>
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 30,
            letterSpacing: 2,
            color: '#475569',
            fontFamily: 'sans-serif',
          }}
        >
          Encuentra al profesional que necesitas, cerca de ti
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            width: '100%',
            height: 12,
            background: accent,
          }}
        />
      </div>
    ),
    { ...size },
  )
}
