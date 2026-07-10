import type { Metadata } from "next";
import { Cormorant_Garamond, Montserrat } from "next/font/google";
import "./globals.css";
import "flag-icons/css/flag-icons.min.css";
import UserHeader from "@/components/UserHeader";

import ClientProviders from "@/components/ClientProviders";
import FloatingLangSelector from "@/components/FloatingLangSelector";
import MarketplaceChat from "@/components/MarketplaceChat";
import PushPermission from "@/components/PushPermission";
import IdleLogout from "@/components/IdleLogout";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { rootJsonLd, jsonLdString } from "@/lib/seo";
import { MARKETPLACE } from "@/config/marketplace.config";

// The theme palette lives in MARKETPLACE.brand.colors (source of truth). We turn
// it into `--brand-*` CSS variables injected inline on <html>, overriding the
// globals.css fallbacks. Every `--v-*` token aliases to `--brand-*`, so this is
// all it takes to rebrand; unset values fall back to the globals.css default.
//
// `#RRGGBB` → `"R, G, B"` for the rgba() tints. Returns null for anything that
// isn't a 6-digit hex, so a malformed override is silently skipped.
function hexToRgb(hex: string): string | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function brandThemeCss(): string {
  const { primary, dark, light } = MARKETPLACE.brand.colors;
  const root: string[] = [];
  const darkRules: string[] = [];

  if (primary) {
    root.push(`--brand-primary:${primary}`);
    const rgb = hexToRgb(primary);
    if (rgb) root.push(`--brand-primary-rgb:${rgb}`);
  }
  if (light) {
    root.push(`--brand-bg:${light}`);
    const rgb = hexToRgb(light);
    if (rgb) root.push(`--brand-bg-rgb:${rgb}`);
  }
  if (dark) {
    darkRules.push(`--brand-bg:${dark}`);
    const rgb = hexToRgb(dark);
    if (rgb) darkRules.push(`--brand-bg-rgb:${rgb}`);
  }

  // `:root:root` (specificity 0,0,2) so these overrides win over the
  // globals.css fallbacks regardless of stylesheet source order.
  let css = "";
  if (root.length) css += `:root:root{${root.join(";")}}`;
  if (darkRules.length) css += `:root:root.dark{${darkRules.join(";")}}`;
  return css;
}

const cormorant = Cormorant_Garamond({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Legacy UI sans, kept for components still referring to --font-ui. New code
// should default to Switzer instead.
const montserrat = Montserrat({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://example.com'),
  // Tab title. Pages can override via generateMetadata; the template wraps
  // their value. Replace with your own brand + value proposition.
  title: {
    default: 'Marketplace — Find listings near you',
    template: '%s | Marketplace',
  },
  // Keep under ~155 chars so Google doesn't truncate in SERP.
  description:
    'A marketplace to discover and contact verified listings. Replace this with your own description.',
  keywords: ['marketplace', 'listings', 'directory'],
  robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
  openGraph: {
    type:        'website',
    locale:      'es_AR',
    siteName:    'Marketplace',
    title:       'Marketplace',
    description: 'A marketplace to discover and contact verified listings.',
    url:         'https://example.com',
    // Link-share preview is the code-generated src/app/opengraph-image.tsx.
    // Next.js auto-injects it — no static asset.
  },
  twitter: {
    card:        'summary_large_image',
    title:       'Marketplace',
    description: 'A marketplace to discover and contact verified listings.',
  },
  other: {
    'revisit-after':           '7 days',
    'msapplication-TileColor': '#2563EB',
  },
  manifest: '/images/site.webmanifest',
  // Favicon + apple-touch are the code-generated src/app/icon.tsx and
  // src/app/apple-icon.tsx (Next.js auto-wires them) — no static assets.
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  // Matches the site's dark background so the mobile URL bar / PWA chrome
  // blends in instead of flashing white.
  themeColor: '#0F172A',
  colorScheme: 'light dark',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="light" translate="no">
      <head>
        <meta name="google" content="notranslate" />
        <meta name="robots" content="notranslate" />
        {/* Inject the branding palette as `--brand-*` CSS vars before paint.
            Edit colors in marketplace.config.ts to rebrand. */}
        <style dangerouslySetInnerHTML={{ __html: brandThemeCss() }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('app_theme');var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.remove('light');document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=switzer@200,300,400,500,600,700,800&display=swap"
        />
        {/* @graph — WebSite + Organization cross-linked via @id. Drives
            Google's sitelink searchbox and knowledge panel signals. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(rootJsonLd()) }}
        />
      </head>
      <body
        className={`${cormorant.variable} ${montserrat.variable} notranslate antialiased`}
        translate="no"
        style={{ background: 'var(--v-bg-base)', color: 'var(--v-text-primary)' }}
      >
        <ClientProviders>
          <FloatingLangSelector />
          <UserHeader />
          {children}
          <MarketplaceChat />
          <PushPermission />
          <IdleLogout />
        </ClientProviders>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
