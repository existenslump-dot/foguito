import type { MetadataRoute } from 'next'

/**
 * Robots policy for example.com.
 *
 * Strategy:
 *   - Allow everything public: `/`, `/{country}`, `/{country}/{post-slug}`,
 *     `/planes`, `/publicar`, `/blog`, `/perfil/*`, legal pages.
 *   - Block everything private or session-bound: admin surface, API routes
 *     (bots don't need to hit JSON endpoints), the logged-in dashboard, the
 *     Supabase auth callback, the blocked-country screen, the payment success
 *     page (transient per-order URL, not rankable), and the Sentry demo page.
 *   - Login/registro stay crawlable so back-links that deep-link through
 *     `/ingresar?redirect=...` don't get orphaned.
 *
 * Points bots at the canonical sitemap which itself reads NEXT_PUBLIC_APP_URL.
 *
 * Intentionally NOT emitting a `Host:` directive — it was a Yandex-only hint,
 * deprecated since 2018, and Bing's robots.txt tester flags it as an error.
 * The sitemap URL is sufficient for every search engine we care about.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://example.com'

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/admin/*',
          '/api/',
          '/dashboard',
          '/dashboard/*',
          '/auth/',
          '/blocked',
          '/pagos/success',
          '/sentry-example-page',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
