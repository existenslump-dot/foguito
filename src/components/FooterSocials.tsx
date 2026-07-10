'use client'

import type { ReactNode } from 'react'
import { whatsappUrl, telegramUrl } from '@/lib/concierge'

const X_URL = 'https://x.com/marketplaceestudios'
const TELEGRAM_FALLBACK = 'https://t.me/marketplaceescom'

/**
 * Footer social row — inline SVG in an accent-bordered circle (no PNGs).
 * Single source of truth: used by both the GeoFeedPage (/argentina) footer
 * and SiteFooter (legal/info pages), so the two stay identical.
 */
export default function FooterSocials() {
  const wa = whatsappUrl()
  const tg = telegramUrl() || TELEGRAM_FALLBACK
  const socials: Array<{ href: string; label: string; svg: ReactNode }> = []
  if (wa) {
    socials.push({
      href: wa,
      label: 'WhatsApp',
      svg: <path d="M21 11.5a8.5 8.5 0 0 1-13 7.2L3 21l2.3-5A8.5 8.5 0 1 1 21 11.5z" strokeLinecap="round" />,
    })
  }
  socials.push({
    href: tg,
    label: 'Telegram',
    svg: <path d="M21 4 3 11l6 2.5L11 20l3.5-4 5 3.5L21 4z" />,
  })
  socials.push({
    href: X_URL,
    label: 'X',
    svg: <path fill="currentColor" d="M18 3h3l-7.3 8.3L22 21h-6.6l-5.2-6.8L4 21H1l7.8-8.9L1 3h6.7l4.7 6.2L18 3zm-2.3 16h1.7L7.6 5H5.8l9.9 14z" stroke="none" />,
  })
  return (
    <div className="flex gap-2.5 justify-center">
      {socials.map(s => (
        <a
          key={s.label}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={s.label}
          className="w-8 h-8 flex items-center justify-center rounded-full border border-[rgba(37,99,235,0.18)] text-[rgba(37,99,235,0.6)] hover:text-[var(--v-accent)] hover:border-[rgba(37,99,235,0.32)] transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[14px] h-[14px]">
            {s.svg}
          </svg>
        </a>
      ))}
    </div>
  )
}
