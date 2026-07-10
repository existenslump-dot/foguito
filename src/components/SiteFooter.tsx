'use client'
import Link from 'next/link'
import { useLang } from '@/contexts/LanguageContext'
import { t } from '@/lib/i18n'
import FooterSocials from '@/components/FooterSocials'
import MarketplaceWordmark from '@/components/MarketplaceWordmark'
import { PAYMENTS_UI_ENABLED } from '@/config/marketplace.config'

/**
 * 4-column site footer reused across legal/info/contact pages.
 *
 * Single source of truth for the OF-style footer originally inlined in
 * GeoFeedPage + PostDetailView. Columns: Brand · Plataforma · Soporte · Legal.
 * Bottom row repeats the gateway copyright block (brand + directory tagline
 * + generic data-protection note) so every secondary surface lands on the
 * same brand-trust closure.
 *
 * Needs the LanguageProvider in ancestor tree (provided globally by
 * ClientProviders in src/app/layout.tsx) — safe to drop into any page.
 */
export default function SiteFooter() {
  const { lang } = useLang()

  return (
    <footer className="mt-12 border-t border-[rgba(37,99,235,0.08)] px-6 pt-12 pb-8">
      <div className="mx-auto max-w-[1280px]">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-10">

          {/* Col 1 — Brand */}
          <div className="col-span-2 md:col-span-1 flex flex-col items-start gap-4">
            <Link href="/" aria-label="Marketplace — ir al inicio" className="no-underline">
              <MarketplaceWordmark size={22} />
            </Link>
            <a
              href="mailto:contacto@example.com"
              className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] tracking-[.04em] text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors no-underline whitespace-nowrap"
            >
              contacto@example.com
            </a>
            <FooterSocials />
          </div>

          {/* Col 2 — Plataforma */}
          <div>
            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-medium tracking-[.24em] uppercase text-[var(--v-accent)] mb-4">
              {t(lang, 'foot_col_platform')}
            </p>
            <ul className="flex flex-col gap-3 list-none p-0 m-0">
              <li><Link href="/publicar" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] tracking-[.04em] text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors no-underline">{t(lang, 'gw_publicar')}</Link></li>
              {PAYMENTS_UI_ENABLED && (
                <li><Link href="/planes" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] tracking-[.04em] text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors no-underline">{t(lang, 'gw_planes')}</Link></li>
              )}
              <li><Link href="/ingresar" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] tracking-[.04em] text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors no-underline">{t(lang, 'gw_acceso')}</Link></li>
              <li><Link href="/registro" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] tracking-[.04em] text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors no-underline">{t(lang, 'gw_registro')}</Link></li>
            </ul>
          </div>

          {/* Col 3 — Soporte */}
          <div>
            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-medium tracking-[.24em] uppercase text-[var(--v-accent)] mb-4">
              {t(lang, 'foot_col_support')}
            </p>
            <ul className="flex flex-col gap-3 list-none p-0 m-0">
              <li><Link href="/faq" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] tracking-[.04em] text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors no-underline">{t(lang, 'feed_faq')}</Link></li>
              <li><Link href="/contacto" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] tracking-[.04em] text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors no-underline">{t(lang, 'contact_title')}</Link></li>
            </ul>
          </div>

          {/* Col 4 — Legal */}
          <div>
            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-medium tracking-[.24em] uppercase text-[var(--v-accent)] mb-4">
              {t(lang, 'foot_col_legal')}
            </p>
            <ul className="flex flex-col gap-3 list-none p-0 m-0">
              <li><Link href="/terminos" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] tracking-[.04em] text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors no-underline">{t(lang, 'age_terms_short')}</Link></li>
              <li><Link href="/privacidad" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] tracking-[.04em] text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors no-underline">{t(lang, 'age_privacy_short')}</Link></li>
            </ul>
          </div>

        </div>

        <div className="mt-12 pt-8 border-t border-[rgba(37,99,235,0.06)] text-center">
          <p className="v-legal mb-[2px]">© 2026 Marketplace ✦</p>
          <p className="v-legal mb-[2px]">Directorio de servicios y profesionales</p>
          <p className="v-legal">Operamos conforme a la normativa de protección de datos aplicable</p>
        </div>
      </div>
    </footer>
  )
}
