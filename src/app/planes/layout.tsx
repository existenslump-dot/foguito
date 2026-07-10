import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { BASE_URL, breadcrumbListJsonLd, jsonLdString } from '@/lib/seo'
import { PACKAGE_LIST } from '@/lib/packages'
import { PAYMENTS_ENABLED, COUNTRY_LABEL } from '@/config/marketplace.config'

// Static metadata for the tier catalog — the page itself is a client
// component (lots of interactive state), so the SEO fields live here so
// they're served in the initial HTML instead of being empty / inherited
// from the root layout.
export const metadata: Metadata = {
  title: 'Planes y niveles · Marketplace',
  description:
    'Conocé los niveles Elite, Gold, Silver, Bronze y Basic de Marketplace. Beneficios, alcance, historias, reseñas y verificación — pensados para publicaciones exclusivas.',
  alternates: { canonical: '/planes' },
  openGraph: {
    title: 'Planes y niveles · Marketplace',
    description:
      'Elegí el nivel que mejor se ajusta a tu publicación. Exposición preferente, historias y verificación desde Bronze hasta Elite.',
    url: '/planes',
    type: 'website',
  },
  robots: { index: true, follow: true },
}

/**
 * Service schema for each tier — gives Google a structured price + offer
 * per plan so the SERP row can show "from 49 USD/month" next to the
 * /planes result and the tier cards qualify for rich-result eligibility.
 * Emitted as an ItemList of services so the page looks like a catalog
 * (not a single-service page).
 */
const planesServicesJsonLd = {
  '@context':      'https://schema.org',
  '@type':         'ItemList',
  itemListElement: PACKAGE_LIST.map((pkg, i) => ({
    '@type':    'ListItem',
    position:   i + 1,
    item: {
      '@type':        'Service',
      '@id':          `${BASE_URL}/planes#${pkg.id}`,
      name:           pkg.label.split(' — ')[0].trim(),
      description:    `Nivel ${pkg.label.split(' — ')[0].trim()} — publicación basic verificada en Marketplace.`,
      provider:       { '@id': `${BASE_URL}/#organization` },
      areaServed:     { '@type': 'Country', name: COUNTRY_LABEL },
      offers: {
        '@type':         'Offer',
        price:           pkg.price_usd,
        priceCurrency:   'USD',
        availability:    'https://schema.org/InStock',
        priceSpecification: {
          '@type':                'UnitPriceSpecification',
          price:                  pkg.price_usd,
          priceCurrency:          'USD',
          billingDuration:        'P1M',
          unitCode:               'MON',
          referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' },
        },
      },
    },
  })),
}

const planesBreadcrumbs = breadcrumbListJsonLd([
  { name: 'Inicio',  path: '/' },
  { name: 'Planes',  path: '/planes' },
])

export default function PlanesLayout({ children }: { children: React.ReactNode }) {
  // Payments is a paid add-on, off by default. When disabled the plans page
  // must be unreachable — bounce to the gateway. Page kept intact for when
  // the add-on is enabled.
  if (!PAYMENTS_ENABLED) redirect('/')
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(planesServicesJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(planesBreadcrumbs) }}
      />
      {children}
    </>
  )
}
