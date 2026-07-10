import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * Build Sentry's CSP violation endpoint URL from `NEXT_PUBLIC_SENTRY_DSN`.
 *
 * DSN format:  `https://{PUBLIC_KEY}@{SUBDOMAIN}.ingest.sentry.io/{PROJECT_ID}`
 * Endpoint:    `https://{SUBDOMAIN}.ingest.sentry.io/api/{PROJECT_ID}/security/?sentry_key={PUBLIC_KEY}`
 *
 * Returns null when the DSN is absent or malformed so the headers() block
 * can skip the reporting directives entirely instead of emitting a broken
 * endpoint. Env is also tagged (`&sentry_environment=production`) so the
 * Sentry UI filters by Vercel environment out of the box.
 */
function cspReportUri(): string | null {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) return null
  try {
    const u = new URL(dsn)
    const publicKey = u.username
    const projectId = u.pathname.replace(/^\//, '')
    if (!publicKey || !projectId) return null
    const env = process.env.VERCEL_ENV || process.env.NODE_ENV || 'production'
    return `${u.origin}/api/${projectId}/security/?sentry_key=${publicKey}&sentry_environment=${encodeURIComponent(env)}`
  } catch {
    return null
  }
}

const CSP_REPORT_URI = cspReportUri()

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Workspace packages ship TypeScript source; Next transpiles them in-place.
  transpilePackages: ['@marketplace/payments-kit'],
  images: {
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      // Stock-photo host used by the demo seed listings (coherent service
      // imagery). Safe to remove if your deployment serves all media from
      // Cloudinary.
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  async redirects() {
    return [
      // /acceso renombrada a /ingresar en v29 (rebrand auth). Redirect 301
      // preserva back-compat para emails de recuperación/confirm + links
      // viejos indexados en Google. Cualquier internal link nuevo usa
      // /ingresar directo.
      { source: '/acceso', destination: '/ingresar', permanent: true },
      // Old long-form URL preserved as a permanent redirect to /publicar.
      { source: '/me-quiero-publicar', destination: '/publicar', permanent: true },
      // Legal pages moved from /legal/* to root (2026-04-19) — shorter URLs,
      // brief-aligned ES content, and unifying the EN duplicates (/legal/terms,
      // /legal/privacy) onto their Spanish equivalents.
      { source: '/legal/terminos',      destination: '/terminos',      permanent: true },
      { source: '/legal/privacidad',    destination: '/privacidad',    permanent: true },
      { source: '/legal/terms',         destination: '/terminos',      permanent: true },
      { source: '/legal/privacy',       destination: '/privacidad',    permanent: true },
      // Country feed canonicalised to /home (generic, de-branded landing).
      // Exact-match only so deeper paths (/argentina/post/…, geo segments)
      // keep resolving — they are served by the [city] route unchanged.
      { source: '/argentina', destination: '/home', permanent: true },
    ]
  },
  // Serve the country feed at /home without renaming the geo slug: /home is
  // internally rewritten to the /argentina ([city]) route, so the URL bar
  // shows /home while the existing feed logic runs unchanged. Paired with the
  // /argentina → /home redirect above (redirects run on the incoming path, so
  // this internal rewrite target does not re-trigger it — no loop).
  async rewrites() {
    // beforeFiles: must run BEFORE the dynamic /[city] route, otherwise
    // /home would be captured as city="home" (which resolves to nothing).
    return {
      beforeFiles: [
        { source: '/home', destination: '/argentina' },
      ],
      afterFiles: [],
      fallback: [],
    }
  },
  async headers() {
    // Core headers shared across every route.
    const baseHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    ]

    // `Reporting-Endpoints` is the modern, per-header way to declare where
    // `report-to` directives POST their payloads. Only emitted when the
    // Sentry DSN parsed — without it `report-to csp-endpoint` would just
    // drop on the floor.
    if (CSP_REPORT_URI) {
      baseHeaders.push({
        key: 'Reporting-Endpoints',
        value: `csp-endpoint="${CSP_REPORT_URI}"`,
      })
    }

    return [
      {
        // Static brand/UI assets in /public/images/ — logos, country tiles,
        // OG image, favicons, country illustrations. Vercel default is
        // `Cache-Control: public, max-age=0, must-revalidate` which forces
        // a revalidation round-trip on every visit. These files change
        // rarely; treat them as immutable for 1 year. If a real swap is
        // needed (e.g. logo refresh), rename the file (cache-busting via
        // filename) or purge the CF cache manually.
        source: '/images/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          ...baseHeaders,
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Added vercel.live for the preview feedback widget + fontshare for Switzer.
              // jsdelivr.net hosts browser-image-compression which we lazy-load
              // during photo uploads — without it the create flow either runs
              // uncompressed (slow/expensive Cloudinary uploads) or throws a
              // ChunkLoadError. unpkg added as a backup for the same package.
              // static.cloudflareinsights.com sirve el beacon de Cloudflare Web
              // Analytics (RUM) que CF auto-inyecta en el sitio proxeado; sin
              // esto la consola tira un CSP violation y el beacon no carga.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://hcaptcha.com https://*.hcaptcha.com https://*.mercadopago.com https://sdk.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com https://http2.mlstatic.com https://challenges.cloudflare.com https://static.cloudflareinsights.com https://vercel.live https://cdn.jsdelivr.net https://unpkg.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://http2.mlstatic.com https://api.fontshare.com",
              "font-src 'self' https://fonts.gstatic.com https://http2.mlstatic.com https://api.fontshare.com https://cdn.fontshare.com https://vercel.live",
              // Mercado Libre proper (not just *.mercadopago.com) is needed for MP's fingerprint pixel.
              // `mercadolivre.com` (BR, Portuguese "v") ships alongside
              // `mercadolibre.com` (everyone else, Spanish "b") because
              // MP picks the regional host at runtime — users logging
              // in from Brazil load the fingerprint from the .com.br
              // cousin and the CSP would block it otherwise (seen in
              // Sentry: BR IP, /pagos, blocked
              // https://www.mercadolivre.com/jms/mlb/lgz/fingerprint/…).
              // vercel.com / vercel.live images are used by the preview feedback widget.
              // Added res.cloudinary.com (already) + api.nowpayments.io (logo + qr).
              "img-src 'self' data: blob: https://res.cloudinary.com https://images.unsplash.com https://api.qrserver.com https://http2.mlstatic.com https://*.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com https://vercel.com https://vercel.live https://api.nowpayments.io",
              "media-src 'self' blob: https://res.cloudinary.com",
              "worker-src 'self' blob:",
              // MP Bricks pulls locale JSON from http2.mlstatic.com and fingerprint/iframe
              // from www.mercadolibre.com — both must be in connect-src or the card
              // form silently stalls in 'Cargando…'.
              // Added res.cloudinary.com (image uploads) +
              // api.nowpayments.io (crypto invoices) so admin fetch / uploads aren't blocked.
              // data: is required so dashboard/create + edit can convert PhotoEditor
              // data URLs to Blob via `fetch(dataURL)`. Without it, admin post creation
              // fails silently with "Fetch API cannot load data:image/..." in console.
              // cloudflareinsights.com recibe los datos del beacon de Cloudflare
              // Web Analytics (el script vive en static.cloudflareinsights.com,
              // ver script-src).
              "connect-src 'self' data: blob: https://*.supabase.co wss://*.supabase.co https://api.cloudinary.com https://res.cloudinary.com https://api.resend.com https://api.frankfurter.app https://api.frankfurter.dev https://hcaptcha.com https://*.hcaptcha.com https://*.sentry.io https://*.ingest.sentry.io https://api.mercadopago.com https://api.mercadolibre.com https://*.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com https://http2.mlstatic.com https://vercel.live https://api.nowpayments.io https://cloudflareinsights.com",
              "frame-src https://hcaptcha.com https://*.hcaptcha.com https://*.mercadopago.com https://bricks.mercadopago.com https://merchant.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com https://challenges.cloudflare.com https://vercel.live https://nowpayments.io https://*.nowpayments.io",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              // Clickjacking defense — modern CSP equivalent of the
              // X-Frame-Options: DENY header we already set. Kept both:
              // frame-ancestors is the standard going forward, XFO stays
              // for the handful of old browsers that ignore CSP.
              "frame-ancestors 'none'",
              // Automatically rewrite any accidental http:// resource to
              // https:// before fetching. Next's build shouldn't emit
              // any http URLs, but this catches a stray link in user-
              // authored blog markdown or a third-party SDK that decides
              // to serve a fallback over plaintext.
              "upgrade-insecure-requests",
              // Violation reporting — emit both directives when the DSN
              // is configured. `report-uri` is legacy (still honoured by
              // Safari, older Chrome); `report-to` references the named
              // endpoint declared in the `Reporting-Endpoints` header
              // above and is the path forward.
              ...(CSP_REPORT_URI
                ? [`report-uri ${CSP_REPORT_URI}`, 'report-to csp-endpoint']
                : []),
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});