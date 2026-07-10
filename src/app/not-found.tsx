import Link from 'next/link'
import MarketplaceWordmark from '@/components/MarketplaceWordmark'
import type { Metadata } from 'next'
import { MARKETPLACE, COUNTRY_LABEL } from '@/config/marketplace.config'

// Server component — `not-found.tsx` runs on any non-existent route (or when
// `notFound()` is invoked explicitly in another route segment). The real 404
// status code is preserved (Next.js emits it automatically), so Google
// deindexes the broken URL correctly instead of treating a redirect as a
// soft 404.
//
// Styling follows the light/tech re-skin: white background, blue accent via
// the `--brand-*`/`--v-*` tokens, matching the main feed header.

export const metadata: Metadata = {
  title: 'Página no encontrada — Marketplace',
  // No-index — without this Google could treat 404 URLs as valid content.
  // The 404 status code already pushes deindex; robots reinforces it.
  robots: { index: false, follow: false },
}

const LEGAL_LINKS = [
  { href: '/terminos',   label: 'Términos'   },
  { href: '/privacidad', label: 'Privacidad' },
  { href: '/faq',        label: 'FAQ'        },
]

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--v-bg-base)',
        color: 'var(--v-text-primary)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        .nf-fade{opacity:0;animation:fadeUp .8s cubic-bezier(.22,1,.36,1) forwards}
        .nf-d1{animation-delay:.1s} .nf-d2{animation-delay:.25s}
        .nf-d3{animation-delay:.4s} .nf-d4{animation-delay:.55s}

        .nf-cta-primary{
          display:inline-flex;align-items:center;justify-content:center;
          background:var(--v-accent);color:var(--v-text-inverse);
          padding:16px 36px;border-radius:6px;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:13px;font-weight:500;letter-spacing:.22em;
          text-transform:uppercase;text-decoration:none;
          transition:background .4s ease;
        }
        .nf-cta-primary:hover{background:var(--v-accent-light)}

        .nf-cta-outline{
          display:inline-flex;align-items:center;justify-content:center;
          background:transparent;color:var(--v-accent-strong);
          padding:14px 28px;border-radius:6px;
          border:1px solid var(--v-border-accent);
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:11px;font-weight:500;letter-spacing:.22em;
          text-transform:uppercase;text-decoration:none;
          transition:border-color .4s ease, color .4s ease;
        }
        .nf-cta-outline:hover{border-color:var(--v-accent);color:var(--v-accent)}

        .v-legal-link{color:var(--v-text-tertiary);text-decoration:none;transition:color .4s ease}
        .v-legal-link:hover{color:var(--v-accent-strong)}
      `}</style>

      {/* Center column — hero content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '48px 24px',
        }}
      >
        {/* Brand wordmark */}
        <Link href="/" className="nf-fade" aria-label="Marketplace" style={{ marginBottom: '32px' }}>
          <MarketplaceWordmark size={28} />
        </Link>

        {/* Hero copy */}
        <p
          className="nf-fade nf-d1"
          style={{
            fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
            fontSize: '9px',
            fontWeight: 400,
            letterSpacing: '.32em',
            textTransform: 'uppercase',
            color: 'var(--v-accent-strong)',
            marginBottom: '16px',
          }}
        >
          Error 404
        </p>

        <h1
          className="nf-fade nf-d2"
          style={{
            fontFamily: "'Cormorant Garamond', 'Cormorant', Georgia, serif",
            fontWeight: 300,
            fontSize: 'clamp(36px, 7vw, 56px)',
            color: 'var(--v-text-primary)',
            marginBottom: '20px',
            lineHeight: 1.15,
          }}
        >
          Página no encontrada
        </h1>

        <p
          className="nf-fade nf-d3"
          style={{
            fontFamily: "'Cormorant Garamond', 'Cormorant', Georgia, serif",
            fontStyle: 'italic',
            fontWeight: 300,
            fontSize: 'clamp(15px, 2.5vw, 19px)',
            color: 'var(--v-text-secondary)',
            maxWidth: '480px',
            lineHeight: 1.55,
            marginBottom: '40px',
          }}
        >
          La página que buscás ya no está disponible o nunca existió. Explorá las opciones de abajo para encontrar lo que necesitás.
        </p>

        {/* CTAs */}
        <div
          className="nf-fade nf-d4"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            justifyContent: 'center',
            marginBottom: '20px',
          }}
        >
          <Link href="/" className="nf-cta-primary">Ir al inicio</Link>
          <Link href={`/${MARKETPLACE.market.defaultCountrySlug}`} className="nf-cta-outline">Ver servicios</Link>
          <Link href="/faq" className="nf-cta-outline">FAQ</Link>
        </div>
      </div>

      {/* Footer — same legal block as GeoFeedPage / PostDetailView */}
      <footer
        style={{
          marginTop: 'auto',
          borderTop: '1px solid var(--v-border-subtle)',
          paddingTop: '48px',
          paddingBottom: '48px',
          paddingLeft: '24px',
          paddingRight: '24px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            marginBottom: '16px',
          }}
        >
          {LEGAL_LINKS.map((l, i, arr) => (
            <span key={l.href} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Link href={l.href} className="v-legal v-legal-link">{l.label}</Link>
              {i < arr.length - 1 && <span style={{ fontSize: '10px', color: 'var(--v-text-tertiary)' }}>·</span>}
            </span>
          ))}
        </div>
        <p className="v-legal" style={{ marginBottom: '8px', color: 'var(--v-text-tertiary)' }}>Marketplace 2026</p>
        <p className="v-legal" style={{ color: 'var(--v-text-tertiary)' }}>Los mejores servicios y profesionales de {COUNTRY_LABEL}</p>
      </footer>
    </main>
  )
}
