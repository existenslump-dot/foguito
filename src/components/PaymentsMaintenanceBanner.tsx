'use client'
import Link from 'next/link'
import LogoLink from './LogoLink'
import { whatsappUrl, telegramUrl } from '@/lib/concierge'
import { MAINTENANCE_MESSAGE } from '@/lib/maintenance'

const ACCENT = 'var(--v-accent)'
const WHITE = 'var(--v-text-primary)'
const BG = 'var(--v-bg-elevated)'
const font = "'Switzer','Inter','Helvetica Neue',Arial,sans-serif"

export default function PaymentsMaintenanceBanner() {
  const wa = whatsappUrl()
  const tg = telegramUrl()
  return (
    <main style={{ minHeight: '100vh', background: BG, color: WHITE }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: BG,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 60,
          padding: '0 16px',
          borderBottom: '1px solid rgba(37, 99, 235,0.1)',
        }}
      >
        <LogoLink
          alt="Marketplace"
          width={180}
          height={44}
          style={{ height: 44, width: 'auto', objectFit: 'contain' }}
          priority
        />
      </div>

      <div
        style={{
          maxWidth: 640,
          margin: '0 auto',
          padding: '80px 32px 80px',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontFamily: font,
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: ACCENT,
            marginBottom: 18,
          }}
        >
          {MAINTENANCE_MESSAGE.title}
        </p>

        <h1
          style={{
            fontFamily: font,
            fontSize: 'clamp(26px, 4vw, 34px)',
            fontWeight: 400,
            color: WHITE,
            lineHeight: 1.2,
            marginBottom: 24,
          }}
        >
          {MAINTENANCE_MESSAGE.subtitle}
        </h1>

        <div
          style={{
            width: 40,
            height: 1,
            margin: '0 auto 28px',
            background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`,
          }}
        />

        <p
          style={{
            fontFamily: font,
            fontSize: 15,
            fontWeight: 400,
            color: 'var(--v-text-secondary)',
            lineHeight: 1.7,
            marginBottom: 40,
          }}
        >
          {MAINTENANCE_MESSAGE.body}
        </p>

        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginBottom: 32,
          }}
        >
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: font,
                fontSize: 13,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: ACCENT,
                padding: '12px 22px',
                border: `1px solid ${ACCENT}`,
                borderRadius: 6,
                textDecoration: 'none',
                transition: 'background 0.2s ease',
              }}
            >
              WhatsApp
            </a>
          )}
          {tg && (
            <a
              href={tg}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: font,
                fontSize: 13,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: ACCENT,
                padding: '12px 22px',
                border: `1px solid ${ACCENT}`,
                borderRadius: 6,
                textDecoration: 'none',
                transition: 'background 0.2s ease',
              }}
            >
              Telegram
            </a>
          )}
        </div>

        <Link
          href="/"
          style={{
            fontFamily: font,
            fontSize: 12,
            color: 'var(--v-text-tertiary)',
            letterSpacing: '0.05em',
            textDecoration: 'underline',
          }}
        >
          {MAINTENANCE_MESSAGE.cta}
        </Link>
      </div>
    </main>
  )
}
