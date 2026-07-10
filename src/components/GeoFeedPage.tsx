'use client'
import Link from 'next/link'
import MarketplaceWordmark from '@/components/MarketplaceWordmark'
import { Suspense } from 'react'
import CityClient from '@/components/CityClient'
import CityFaq from '@/components/CityFaq'
import FooterSocials from '@/components/FooterSocials'
import { getGeoDisplayName, type GeoPath } from '@/lib/geo'
import type { FeedPost } from '@/lib/types/post'
import { useLang } from '@/contexts/LanguageContext'
import { t } from '@/lib/i18n'
import { PAYMENTS_UI_ENABLED, COUNTRY_LABEL } from '@/config/marketplace.config'

/**
 * Shared feed page for country/provincia/comuna/barrio routes.
 *
 * The `cityParam` is always the top-level URL segment (country slug) —
 * CityClient threads it into post links which all canonically live under
 * `/{country}/post/<slug>`.
 */
type Props = {
  posts: FeedPost[]
  geo: GeoPath
  cityParam: string
  headline?: string
  aliases?: readonly string[]
  showFaq?: boolean
  displayLabel?: string
}

export default function GeoFeedPage({ posts, geo, cityParam, headline, showFaq, displayLabel }: Props) {
  void displayLabel
  const { lang }    = useLang()
  const geoName     = getGeoDisplayName(geo)
  const h1Text      = headline ?? t(lang, 'feed_h1', { city: geoName })

  return (
    <>
      <style>{`
        .v-legal-link{ color:var(--v-text-tertiary); text-decoration:none; transition:color .4s ease; }
        .v-legal-link:hover{ color:var(--v-accent-strong) }
      `}</style>

      <main className="min-h-screen bg-[var(--v-bg-base)] text-[var(--v-text-primary)]">
        <header className="mx-auto max-w-[820px] px-5 pt-8 pb-4 text-center">
          <h1 className="m-0 font-['Cormorant_Garamond','Playfair_Display',serif] text-[clamp(22px,3vw,32px)] font-medium leading-[1.15] text-[var(--v-text-primary)]">
            {h1Text}
          </h1>
        </header>

        {posts?.length === 0 ? (
          <div className="mx-auto max-w-[820px] px-6 py-12">
            <nav
              aria-label="Breadcrumb"
              className="mb-8 flex flex-wrap items-center gap-1.5 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-normal uppercase tracking-[.18em] text-[var(--v-text-tertiary)]"
            >
              <Link href="/" className="hover:text-[var(--v-accent-strong)] no-underline">
                Inicio
              </Link>
              <span className="text-[var(--v-text-disabled)]">›</span>
              <Link href={`/${cityParam}`} className="hover:text-[var(--v-accent-strong)] no-underline">
                {geo.country.name || cityParam}
              </Link>
              {geo.provincia && (
                <>
                  <span className="text-[var(--v-text-disabled)]">›</span>
                  <Link
                    href={`/${cityParam}/${geo.provincia.slug}`}
                    className="hover:text-[var(--v-accent-strong)] no-underline"
                  >
                    {geo.provincia.name}
                  </Link>
                </>
              )}
              {geo.comuna && (
                <>
                  <span className="text-[var(--v-text-disabled)]">›</span>
                  <Link
                    href={`/${cityParam}/${geo.provincia?.slug}/${geo.comuna.slug}`}
                    className="hover:text-[var(--v-accent-strong)] no-underline"
                  >
                    {geo.comuna.name}
                  </Link>
                </>
              )}
              {headline && (
                <>
                  <span className="text-[var(--v-text-disabled)]">›</span>
                  <span className="text-[var(--v-text-primary)]">{headline}</span>
                </>
              )}
            </nav>

            <div className="rounded-[3px] border border-[rgba(37,99,235,0.15)] bg-[rgba(37,99,235,0.03)] p-8 md:p-10">
              <p className="mb-4 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal uppercase tracking-[.26em] text-[var(--v-accent-strong)]">
                Aún sin anunciantes en esta categoría
              </p>
              <h2 className="mb-5 font-serif text-[clamp(22px,3vw,30px)] font-normal leading-tight text-[var(--v-text-primary)]">
                Sé el primero en publicar en {geoName}
              </h2>
              <p className="mb-4 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[14px] font-normal leading-[1.7] text-[var(--v-text-secondary)]">
                Marketplace es el directorio de servicios y profesionales en{' '}
                {COUNTRY_LABEL}. Cada anuncio puede pasar por verificación de
                identidad y una revisión curada por nuestro equipo antes de
                aparecer públicamente. Tu anuncio se ve solo en example.com —
                nunca en redes sociales con riesgo de baneo (Instagram,
                TikTok), ni en sitios link-farm de baja reputación.
              </p>
              <p className="mb-6 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[14px] font-normal leading-[1.7] text-[var(--v-text-secondary)]">
                En {geoName} todavía no hay anuncios activos en{' '}
                {headline ? <em className="text-[var(--v-text-primary)] font-normal not-italic">{headline}</em> : 'esta categoría'}.
                Publicar primero tiene ventaja: capturás el tráfico orgánico
                de Google (búsquedas como
                «servicios en {geoName.toLowerCase()}») sin competencia directa
                por las próximas semanas. Onboarding self-service, alta en
                menos de 24 horas, soporte por WhatsApp y Telegram desde el
                primer día.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/publicar"
                  className="inline-flex items-center justify-center rounded-[2px] bg-[var(--v-accent)] px-6 py-3 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-medium uppercase tracking-[.22em] text-[#FFFFFF] no-underline transition-colors hover:bg-[var(--v-accent-light)]"
                >
                  Publicar mi anuncio
                </Link>
                <Link
                  href="/faq"
                  className="inline-flex items-center justify-center rounded-[2px] border border-[rgba(37,99,235,0.3)] px-6 py-3 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-medium uppercase tracking-[.22em] text-[var(--v-accent-strong)] no-underline transition-colors hover:border-[rgba(37,99,235,0.6)]"
                >
                  Cómo funciona
                </Link>
              </div>
            </div>

            {geo.provincia && (
              <div className="mt-12">
                <p className="mb-4 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-normal uppercase tracking-[.22em] text-[var(--v-text-tertiary)]">
                  Mientras tanto, explorá otras provincias
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { slug: 'capital-federal', label: 'Capital Federal' },
                    { slug: 'buenos-aires',    label: 'Buenos Aires' },
                    { slug: 'cordoba',         label: 'Córdoba' },
                    { slug: 'mendoza',         label: 'Mendoza' },
                    { slug: 'santa-fe',        label: 'Santa Fe' },
                  ]
                    .filter(p => p.slug !== geo.provincia?.slug)
                    .map(p => (
                      <Link
                        key={p.slug}
                        href={`/${cityParam}/${p.slug}`}
                        className="rounded-[2px] border border-[var(--v-border-subtle)] px-4 py-2 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal text-[var(--v-text-secondary)] no-underline transition-colors hover:border-[rgba(37,99,235,0.4)] hover:text-[var(--v-accent-strong)]"
                      >
                        {p.label}
                      </Link>
                    ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="p-20 text-center text-[8px] tracking-[0.2em] text-[var(--v-text-tertiary)]">
                {t(lang, 'loading')}
              </div>
            }
          >
            <CityClient posts={posts || []} cityParam={cityParam} countryId={geo.country.id} />
          </Suspense>
        )}

        {(showFaq || posts?.length === 0) && <CityFaq cityName={geoName} />}

        <footer className="mt-12 border-t border-[rgba(37,99,235,0.08)] px-6 pt-10 pb-8">
          <div className="mx-auto max-w-[1280px] text-center">
            <div className="flex flex-col items-center gap-3">
              <MarketplaceWordmark size={26} />
              <a
                href="mailto:contacto@example.com"
                className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] tracking-[.02em] text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] transition-colors no-underline"
              >
                contacto@example.com
              </a>
              <div className="mt-1">
                <FooterSocials />
              </div>
            </div>

            <div className="mt-10 grid grid-cols-3 gap-6 md:gap-12 pt-8 pb-8 border-t border-b border-[rgba(37,99,235,0.08)] text-left max-w-[820px] mx-auto">
              <div>
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-medium tracking-[.18em] uppercase text-[var(--v-accent-strong)] mb-3">
                  {t(lang, 'foot_col_platform')}
                </p>
                <ul className="flex flex-col gap-2 list-none p-0 m-0">
                  <li><Link href="/publicar" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] tracking-[.005em] text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] transition-colors no-underline">{t(lang, 'gw_publicar')}</Link></li>
                  {PAYMENTS_UI_ENABLED && (
                    <li><Link href="/planes" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] tracking-[.005em] text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] transition-colors no-underline">{t(lang, 'gw_planes')}</Link></li>
                  )}
                  <li><Link href="/ingresar" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] tracking-[.005em] text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] transition-colors no-underline">{t(lang, 'gw_acceso')}</Link></li>
                  <li><Link href="/registro" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] tracking-[.005em] text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] transition-colors no-underline">{t(lang, 'gw_registro')}</Link></li>
                </ul>
              </div>
              <div>
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-medium tracking-[.18em] uppercase text-[var(--v-accent-strong)] mb-3">
                  {t(lang, 'foot_col_support')}
                </p>
                <ul className="flex flex-col gap-2 list-none p-0 m-0">
                  <li><Link href="/faq" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] tracking-[.005em] text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] transition-colors no-underline">{t(lang, 'feed_faq')}</Link></li>
                  <li><Link href="/contacto" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] tracking-[.005em] text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] transition-colors no-underline">{t(lang, 'contact_title')}</Link></li>
                </ul>
              </div>
              <div>
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-medium tracking-[.18em] uppercase text-[var(--v-accent-strong)] mb-3">
                  {t(lang, 'foot_col_legal')}
                </p>
                <ul className="flex flex-col gap-2 list-none p-0 m-0">
                  <li><Link href="/terminos" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] tracking-[.005em] text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] transition-colors no-underline">{t(lang, 'age_terms_short')}</Link></li>
                  <li><Link href="/privacidad" className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] tracking-[.005em] text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] transition-colors no-underline">{t(lang, 'age_privacy_short')}</Link></li>
                </ul>
              </div>
            </div>

            <p className="mt-6 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10.5px] text-[var(--v-text-tertiary)] leading-[1.6] font-light">
              © 2026 Marketplace <span className="text-[var(--v-accent-strong)]">✦</span> · Directorio de servicios y profesionales<br/>
              Operamos conforme a la normativa de protección de datos aplicable
            </p>
          </div>
        </footer>
      </main>
    </>
  )
}
