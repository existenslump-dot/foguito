'use client'
import { useState } from 'react'
import Link from 'next/link'
import MarketplaceWordmark from '@/components/MarketplaceWordmark'
import { MARKETPLACE, PAYMENTS_UI_ENABLED, COUNTRY_LABEL } from '@/config/marketplace.config'
import { useLang } from '@/contexts/LanguageContext'
import ThemeModeSwitch from '@/components/ThemeModeSwitch'
import { t, type TKey, type Lang } from '@/lib/i18n'
import { PAYMENTS_DISABLED } from '@/lib/maintenance'
import { whatsappUrl, telegramUrl } from '@/lib/concierge'

const TELEGRAM_FALLBACK = 'https://t.me/marketplaceescom'
const X_URL = 'https://x.com/marketplaceestudios'
const LANGS: Lang[] = ['es', 'en', 'pt']

// Brand name — config-driven so the gateway re-skins per deployment.
const BRAND_NAME = MARKETPLACE.brand.name

const LANG_LABELS: Record<Lang, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
}

function TrustIcon({ k }: { k: TKey }) {
  switch (k) {
    case 'gw_bullet_verified':
      return (
        <>
          <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z" />
          <path d="m9 12 2 2 4-4" strokeLinecap="round" />
        </>
      )
    case 'gw_bullet_exclusive':
    case 'gw_bullet_exclusive_short':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" />
        </>
      )
    case 'gw_bullet_location':
      return (
        <>
          <path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
          <circle cx="12" cy="9" r="2.5" />
        </>
      )
    case 'gw_bullet_independent':
    case 'gw_bullet_independent_short':
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
        </>
      )
    default:
      return null
  }
}

function SocialIconsRow({ size = 30 }: { size?: number }) {
  const wa = whatsappUrl()
  const tg = telegramUrl() || TELEGRAM_FALLBACK
  const socials: Array<{ href: string; label: string; svg: React.ReactNode }> = []
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
  const iconSize = Math.round(size * 0.43)
  return (
    <>
      {socials.map(s => (
        <a
          key={s.label}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={s.label}
          className="flex items-center justify-center rounded-full border border-[var(--v-border)] text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] hover:border-[rgba(var(--brand-primary-rgb),0.32)] transition-colors"
          style={{ width: `${size}px`, height: `${size}px` }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: iconSize, height: iconSize }}>
            {s.svg}
          </svg>
        </a>
      ))}
    </>
  )
}

export default function GatewayPage() {
  const { lang, setLang } = useLang()
  const [langPillOpen, setLangPillOpen] = useState(false)

  const TRUST_KEYS_DESKTOP: TKey[] = [
    'gw_bullet_verified',
    'gw_bullet_exclusive',
    'gw_bullet_location',
    'gw_bullet_independent',
  ]
  const TRUST_KEYS_MOBILE: TKey[] = [
    'gw_bullet_verified',
    'gw_bullet_exclusive_short',
    'gw_bullet_location',
    'gw_bullet_independent_short',
  ]

  return (
    <>
      <style>{`
        /* ═══════════════════════════════════════
           V1 MOBILE — Hero Maximal styles (md:hidden)
        ═══════════════════════════════════════ */
        .v1m-hero {
          position: relative;
          height: 500px;
          overflow: hidden;
          background: var(--v-bg-base);
        }
        .v1m-hero::after {
          content: "";
          position: absolute; inset: 0;
          /* Gradient — subtle at the top (just enough for the lang pill to
             read over the panel), transparent in the middle, soft fade to the
             light background in the last 30% so the hero's edge blends into
             the light bg of the .util section below. */
          background: linear-gradient(180deg,
            rgba(15,23,42,0.10) 0%,
            rgba(15,23,42,0.0)  10%,
            rgba(15,23,42,0.0)  55%,
            rgba(var(--v-bg-base-rgb),0.30) 72%,
            rgba(var(--v-bg-base-rgb),0.75) 90%,
            rgba(var(--v-bg-base-rgb),1.0)  100%);
          z-index: 1;
          pointer-events: none;
        }
        .v1m-cta {
          width: 100%;
          padding: 16px 24px 15px;
          background: var(--v-accent);
          color: var(--v-text-inverse);
          border-radius: 999px;
          font-family: 'Inter','Switzer','Helvetica Neue',Arial,sans-serif;
          font-weight: 600;
          font-size: 12.5px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          text-align: center;
          transition: background .3s ease, transform .3s ease;
          display: block;
        }
        .v1m-cta:hover { background: var(--v-accent-light); transform: translateY(-1px); }
        .v1m-region {
          flex: 1;
          padding: 9px 6px 8px;
          border: 1px solid var(--v-border);
          border-radius: 999px;
          color: var(--v-text-secondary);
          font-size: 10.5px;
          letter-spacing: 0.005em;
          font-weight: 400;
          text-align: center;
          transition: color .3s ease, background .3s ease, border-color .3s ease;
        }
        .v1m-region.on {
          background: rgba(var(--brand-primary-rgb),0.08);
          color: var(--v-accent-strong);
          border-color: rgba(var(--brand-primary-rgb),0.32);
        }
        .v1m-region:hover {
          color: var(--v-accent-strong);
          border-color: rgba(var(--brand-primary-rgb),0.32);
        }
        .v1m-utilbtn {
          padding: 14px 12px 13px;
          border: 1px solid var(--v-border);
          border-radius: 8px;
          background: var(--v-bg-card);
          color: var(--v-text-primary);
          font-family: 'Cormorant Garamond', 'Playfair Display', serif;
          font-weight: 500;
          font-size: 13px;
          letter-spacing: 0.06em;
          text-align: center;
          transition: color .3s ease, background .3s ease, border-color .3s ease;
          display: block;
        }
        .v1m-utilbtn.primary {
          background: rgba(var(--brand-primary-rgb),0.08);
          color: var(--v-accent-strong);
          border-color: rgba(var(--brand-primary-rgb),0.32);
        }
        .v1m-utilbtn:hover {
          color: var(--v-accent-strong);
          border-color: rgba(var(--brand-primary-rgb),0.32);
        }

        /* ═══════════════════════════════════════
           V1 DESKTOP — Hero Maximal full screen (md:block)
           Applies to viewports ≥768px. 100vh hero with a background photo
           + subtle ken-burns animation, expanded top-right lang pill,
           logo + tagline + stamp anchored to the bottom-center.
        ═══════════════════════════════════════ */
        @keyframes v1d-kb {
          from { transform: scale(1.04) translate(0, 0); }
          to   { transform: scale(1.10) translate(-1.5%, -0.6%); }
        }
        /* Hero desktop — 42vh (cap 460px) so the WHOLE gateway (lang pill +
           top gradient + hero + primary row + trust + legal + util grid +
           footer + copyright) fits in a single viewport at 100% zoom, no
           scroll, on 1920×1080 with margin and nearly exact at 1440/1536.
           The original mockup used 100vh but the hero anchored the wordmark
           to the bottom, leaving ~400px of empty gradient on top and pushing
           the rest off screen. */
        .v1d-hero {
          position: relative;
          height: 42vh;
          min-height: 330px;
          max-height: 460px;
          overflow: hidden;
          background: var(--v-bg-base);
        }
        .v1d-media-wrap {
          position: absolute; inset: 0;
          animation: v1d-kb 28s ease-in-out infinite alternate;
        }
        .v1d-hero::after {
          content: "";
          position: absolute; inset: 0;
          background:
            linear-gradient(180deg, rgba(15,23,42,0.18) 0%, transparent 25%, transparent 55%, rgba(var(--v-bg-base-rgb),0.95) 100%),
            linear-gradient(90deg,  rgba(15,23,42,0.10) 0%, transparent 30%, transparent 70%, rgba(15,23,42,0.10) 100%);
          z-index: 1;
          pointer-events: none;
        }
        .v1d-cta {
          width: 100%;
          padding: 22px 28px 21px;
          background: var(--v-accent);
          color: var(--v-text-inverse);
          border-radius: 999px;
          font-family: 'Inter','Switzer','Helvetica Neue',Arial,sans-serif;
          font-weight: 600;
          font-size: 14px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          text-align: center;
          transition: background .25s ease, transform .25s ease;
          display: block;
        }
        .v1d-cta:hover { background: var(--v-accent-light); transform: translateY(-1px); }
        .v1d-region {
          flex: 1;
          padding: 14px 8px 13px;
          border: 1px solid var(--v-border);
          border-radius: 999px;
          color: var(--v-text-secondary);
          font-size: 12.5px;
          letter-spacing: 0.005em;
          font-weight: 400;
          text-align: center;
          background: var(--v-bg-card);
          transition: color .2s ease, border-color .2s ease, background .2s ease;
        }
        .v1d-region:hover { color: var(--v-accent-strong); border-color: rgba(var(--brand-primary-rgb),0.32); }
        .v1d-region.on {
          background: rgba(var(--brand-primary-rgb),0.08);
          color: var(--v-accent-strong);
          border-color: rgba(var(--brand-primary-rgb),0.32);
        }
        .v1d-utilbtn {
          padding: 18px 14px 17px;
          border: 1px solid var(--v-border);
          border-radius: 8px;
          background: var(--v-bg-card);
          color: var(--v-text-primary);
          font-family: 'Cormorant Garamond', 'Playfair Display', serif;
          font-weight: 500;
          font-size: 14px;
          letter-spacing: 0.08em;
          text-align: center;
          transition: color .2s ease, background .2s ease, border-color .2s ease;
          display: block;
        }
        .v1d-utilbtn:hover {
          color: var(--v-accent-strong);
          background: rgba(var(--brand-primary-rgb),0.04);
          border-color: rgba(var(--brand-primary-rgb),0.32);
        }
        .v1d-utilbtn.primary {
          background: rgba(var(--brand-primary-rgb),0.08);
          color: var(--v-accent-strong);
          border-color: rgba(var(--brand-primary-rgb),0.32);
        }
        .v1d-trust-cell {
          display: flex; align-items: center; gap: 14px;
          padding: 0 14px;
          border-right: 1px solid var(--v-border);
          font-size: 13.5px;
          color: var(--v-text-primary);
          font-weight: 400;
        }
        .v1d-trust-cell:last-child { border-right: 0; }
      `}</style>

      <main className="min-h-screen bg-[var(--v-bg-base)] text-[var(--v-text-primary)] relative overflow-hidden">

        <div className="md:hidden">

          <section className="v1m-hero">
            <div
              aria-hidden="true"
              className="absolute inset-0 w-full h-full"
              style={{
                background:
                  'radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--v-accent) 22%, transparent) 0%, transparent 55%), linear-gradient(180deg, var(--v-bg-elevated, var(--v-bg-base)) 0%, var(--v-bg-base) 100%)',
              }}
            />

            <div className="absolute top-3 right-3 z-[3] flex items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setLangPillOpen(o => !o)}
                  aria-expanded={langPillOpen}
                  className="inline-flex items-center gap-1.5 px-3 py-[5px] bg-[var(--v-bg-card)] backdrop-blur-md border border-[var(--v-border)] rounded-full text-[var(--v-text-secondary)] text-[10.5px] font-medium tracking-[0.04em]"
                >
                  <svg className="w-2.5 h-2.5 text-[var(--v-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="9"/>
                    <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" strokeLinecap="round"/>
                  </svg>
                  {lang.toUpperCase()}
                  <svg className={`w-2.5 h-2.5 transition-transform ${langPillOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {langPillOpen && (
                  <div className="absolute right-0 mt-1 bg-[var(--v-bg-card)] backdrop-blur-md border border-[var(--v-border)] rounded-md overflow-hidden shadow-lg">
                    {LANGS.filter(l => l !== lang).map(l => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => { setLang(l); setLangPillOpen(false) }}
                        className="block w-full px-3 py-1.5 text-[10.5px] text-[var(--v-text-secondary)] hover:text-[var(--v-accent)] hover:bg-[var(--v-bg-hover)] font-medium tracking-[0.04em]"
                      >
                        {l.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Theme switch — the global header hides itself on the gateway,
                  so it's added here. */}
              <ThemeModeSwitch size="sm" />
            </div>

            <div className="absolute inset-0 z-[2] flex flex-col p-6 pb-8 text-center pointer-events-none">
              <div className="mt-auto flex flex-col items-center">
                <div className="mb-3.5">
                  <MarketplaceWordmark size={34} />
                </div>
                <p className="font-['Cormorant_Garamond','Playfair_Display',serif] italic text-[18px] leading-[1.3] text-[var(--v-text-primary)] mb-5">
                  Encontrá al{' '}
                  <em className="not-italic font-medium text-[var(--v-accent-strong)]">profesional</em>
                  {' '}que necesitás, cerca tuyo
                </p>
                <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9.5px] tracking-[.32em] uppercase text-[var(--v-text-tertiary)] font-medium">
                  Directorio de servicios y profesionales en {COUNTRY_LABEL}
                </span>
              </div>
            </div>
          </section>

          <div className="px-6 pt-6 pb-12 flex flex-col gap-[18px] relative z-[2]">

            <Link href="/home" className="v1m-cta">
              {t(lang, 'gw_ingresar')}
            </Link>

            <div className="flex gap-1.5">
              <Link href="/home" className="v1m-region on">Explorar servicios</Link>
            </div>

            <div className="grid grid-cols-2 gap-x-[18px] gap-y-3.5 p-[18px] rounded-xl border border-[var(--v-border)] bg-[var(--v-bg-card)]">
              {TRUST_KEYS_MOBILE.map(k => (
                <div key={k} className="flex items-center gap-2.5 text-[11.5px] text-[var(--v-text-primary)] font-normal">
                  <span className="w-[26px] h-[26px] rounded-full border border-[rgba(var(--brand-primary-rgb),0.32)] flex items-center justify-center text-[var(--v-accent)] flex-shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3 h-3">
                      <TrustIcon k={k} />
                    </svg>
                  </span>
                  <span>{t(lang, k)}</span>
                </div>
              ))}
            </div>

            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] text-[var(--v-text-secondary)] leading-[1.6] text-center font-light">
              {t(lang, 'gw_legal_1')}{' '}
              <Link href="/terminos" className="text-[var(--v-accent)] underline underline-offset-2 hover:opacity-80 transition-opacity">{t(lang, 'gw_legal_terms')}</Link>
              {' '}{t(lang, 'gw_legal_and')}{' '}
              <Link href="/privacidad" className="text-[var(--v-accent)] underline underline-offset-2 hover:opacity-80 transition-opacity">{t(lang, 'gw_legal_privacy')}</Link>.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <Link href="/publicar" className="v1m-utilbtn primary">{t(lang, 'gw_publicar')}</Link>
              <Link href="/registro" className="v1m-utilbtn">{t(lang, 'gw_registro')}</Link>
              {PAYMENTS_UI_ENABLED && (
                <Link href="/planes" className="v1m-utilbtn">{t(lang, 'gw_planes')}</Link>
              )}
              <Link href="/ingresar" className="v1m-utilbtn">{t(lang, 'gw_acceso')}</Link>
            </div>
            {PAYMENTS_UI_ENABLED && !PAYMENTS_DISABLED && (
              <Link href="/pagos" className="v1m-utilbtn block text-center mt-2">{t(lang, 'gw_pagos')}</Link>
            )}

            <div className="flex flex-wrap justify-center gap-x-[18px] gap-y-3.5 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] text-[var(--v-text-secondary)]">
              <Link href="/faq" className="hover:text-[var(--v-accent)] transition-colors">FAQ</Link>
            </div>

            <div className="flex gap-2.5 justify-center">
              <SocialIconsRow size={30} />
            </div>

            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] text-[var(--v-text-tertiary)] leading-[1.6] text-center font-light">
              © 2026 {BRAND_NAME} <span className="text-[var(--v-accent)]">✦</span><br/>
              Operamos conforme a la normativa de protección de datos aplicable
            </p>
          </div>
        </div>

        <div className="hidden md:block">

          <section className="v1d-hero">
            <div className="v1d-media-wrap">
              <div
                aria-hidden="true"
                className="absolute inset-0 w-full h-full"
                style={{
                  background:
                    'radial-gradient(120% 90% at 55% 0%, color-mix(in srgb, var(--v-accent) 22%, transparent) 0%, transparent 55%), linear-gradient(180deg, var(--v-bg-elevated, var(--v-bg-base)) 0%, var(--v-bg-base) 100%)',
                }}
              />
            </div>

            <div className="absolute inset-0 z-[2] flex flex-col px-12 pt-6 pb-8">
              <div className="flex justify-between items-center">
                <span />
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setLangPillOpen(o => !o)}
                      aria-expanded={langPillOpen}
                      className="inline-flex items-center gap-2 px-3.5 py-[7px] bg-[var(--v-bg-card)] backdrop-blur-md border border-[var(--v-border)] rounded-full text-[var(--v-text-secondary)] text-[12px] font-medium hover:border-[rgba(var(--brand-primary-rgb),0.32)] hover:text-[var(--v-accent-strong)] transition-all shadow-sm"
                    >
                      <svg className="w-3 h-3 text-[var(--v-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <circle cx="12" cy="12" r="9"/>
                        <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" strokeLinecap="round"/>
                      </svg>
                      {LANG_LABELS[lang]}
                      <svg className={`w-3 h-3 transition-transform ${langPillOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {langPillOpen && (
                      <div className="absolute right-0 mt-1 bg-[var(--v-bg-card)] backdrop-blur-md border border-[var(--v-border)] rounded-md overflow-hidden min-w-[140px] shadow-lg">
                        {LANGS.filter(l => l !== lang).map(l => (
                          <button
                            key={l}
                            type="button"
                            onClick={() => { setLang(l); setLangPillOpen(false) }}
                            className="block w-full px-4 py-2 text-left text-[12px] text-[var(--v-text-secondary)] hover:text-[var(--v-accent)] hover:bg-[var(--v-bg-hover)] font-medium"
                          >
                            {LANG_LABELS[l]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <ThemeModeSwitch />
                </div>
              </div>

              <div className="mt-auto flex flex-col items-center text-center">
                <div className="mb-3">
                  <MarketplaceWordmark size={56} />
                </div>
                <p className="font-['Cormorant_Garamond','Playfair_Display',serif] italic text-[30px] leading-[1.3] text-[var(--v-text-primary)] mb-4">
                  Encontrá al{' '}
                  <em className="not-italic font-medium text-[var(--v-accent-strong)]">profesional</em>
                  {' '}que necesitás, cerca tuyo
                </p>
                <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] tracking-[.32em] uppercase text-[var(--v-text-tertiary)] font-medium">
                  Directorio de servicios y profesionales en {COUNTRY_LABEL}
                </span>
              </div>
            </div>
          </section>

          <section className="max-w-[1440px] mx-auto px-12 pt-6 pb-8 flex flex-col gap-5">

            <div className="grid grid-cols-2 gap-8 items-center">
              <Link href="/home" className="v1d-cta">
                {t(lang, 'gw_ingresar')}
              </Link>
              <div className="flex gap-2">
                <Link href="/home" className="v1d-region on">Explorar servicios</Link>
              </div>
            </div>

            <div className="grid grid-cols-4 px-6 py-4 rounded-xl border border-[var(--v-border)] bg-[var(--v-bg-card)]">
              {TRUST_KEYS_DESKTOP.map(k => (
                <div key={k} className="v1d-trust-cell">
                  <span className="w-9 h-9 rounded-full border border-[rgba(var(--brand-primary-rgb),0.32)] flex items-center justify-center text-[var(--v-accent)] flex-shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[15px] h-[15px]">
                      <TrustIcon k={k} />
                    </svg>
                  </span>
                  <span>{t(lang, k)}</span>
                </div>
              ))}
            </div>

            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] text-[var(--v-text-secondary)] leading-[1.6] text-center font-light max-w-[640px] mx-auto">
              {t(lang, 'gw_legal_1')}{' '}
              <Link href="/terminos" className="text-[var(--v-accent)] underline underline-offset-2 hover:opacity-80 transition-opacity">{t(lang, 'gw_legal_terms')}</Link>
              {' '}{t(lang, 'gw_legal_and')}{' '}
              <Link href="/privacidad" className="text-[var(--v-accent)] underline underline-offset-2 hover:opacity-80 transition-opacity">{t(lang, 'gw_legal_privacy')}</Link>.
            </p>

            <div className="grid grid-cols-4 gap-2.5">
              <Link href="/publicar" className="v1d-utilbtn primary">{t(lang, 'gw_publicar')}</Link>
              <Link href="/registro" className="v1d-utilbtn">{t(lang, 'gw_registro')}</Link>
              {PAYMENTS_UI_ENABLED && (
                <Link href="/planes" className="v1d-utilbtn">{t(lang, 'gw_planes')}</Link>
              )}
              <Link href="/ingresar" className="v1d-utilbtn">Acceso</Link>
            </div>
            {PAYMENTS_UI_ENABLED && !PAYMENTS_DISABLED && (
              <div className="-mt-4">
                <Link href="/pagos" className="v1d-utilbtn block max-w-[200px] mx-auto">{t(lang, 'gw_pagos')}</Link>
              </div>
            )}

            <div className="flex justify-between items-center gap-6 flex-wrap mt-1 pt-5 border-t border-[var(--v-border)]">
              <div className="flex flex-wrap gap-x-[22px] gap-y-3 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] text-[var(--v-text-secondary)]">
                <Link href="/terminos" className="hover:text-[var(--v-accent)] transition-colors">{t(lang, 'age_terms_short')}</Link>
                <Link href="/privacidad" className="hover:text-[var(--v-accent)] transition-colors">{t(lang, 'age_privacy_short')}</Link>
                <Link href="/faq" className="hover:text-[var(--v-accent)] transition-colors">FAQ</Link>
              </div>
              <div className="flex gap-2.5">
                <SocialIconsRow size={32} />
              </div>
            </div>

            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] text-[var(--v-text-tertiary)] leading-[1.7] text-center font-light pt-3 border-t border-[var(--v-border)]">
              © 2026 {BRAND_NAME} <span className="text-[var(--v-accent)]">✦</span> · Directorio de servicios y profesionales en {COUNTRY_LABEL}<br/>
              Operamos conforme a la normativa de protección de datos aplicable
            </p>
          </section>
        </div>

      </main>
    </>
  )
}
