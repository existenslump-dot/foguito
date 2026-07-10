// ─────────────────────────────────────────────────────────────────────────────
// MARKETPLACE STARTER — Central configuration
// ─────────────────────────────────────────────────────────────────────────────
//
// One place decides everything that differs between deployments: branding,
// target market (country / currency / locale), enabled features, the listing
// taxonomy, and third-party integrations.
//
// The engine reads from `MARKETPLACE` (the active config). Country, currency,
// locale and brand come from env so the same build serves any deployment — set
// them at deploy time. Secrets/tokens stay in env.
//
// ▸ Quick start: copy `.env.example` → `.env.local`, fill in your Supabase /
//   Cloudinary / payment keys, set NEXT_PUBLIC_SITE_NAME, and run `npm run dev`.
// ▸ Taxonomy: define your listing categories in the `categories` table (or set
//   `vertical.taxonomySource: 'static'` and list them below).
// ─────────────────────────────────────────────────────────────────────────────

export type MarketConfig = {
  /** ISO-3166 alpha-2 codes the site serves. Middleware geo-block reads this. */
  allowedCountries: string[]
  /** Default country for geo resolution + which geo seed to load. */
  defaultCountry: string
  /** Lowercase URL slug of the default country as it exists in the `countries`
   *  DB table (e.g. 'argentina', 'united-states'). Distinct from `defaultCountry`
   *  (ISO code) because the geo routes key on slug, not code. Used for x-default
   *  hreflang, vanity-URL country scoping, and post-URL fallbacks. */
  defaultCountrySlug: string
  /** ISO-4217 currency for pricing + the payment provider. */
  currency: string
  /** BCP-47 default locale + the full set offered by the i18n layer. */
  defaultLocale: string
  locales: string[]
  /** E.164 dial code for the default market (e.g. '+1', '+54'). Prefills the
   *  phone-country picker. */
  dialCode: string
  /** Flag asset path for the default market's country picker (e.g.
   *  '/images/united-states.png'). Empty = no flag rendered. */
  flag: string
}

export type FeatureFlags = {
  /** Identity / verification flow + verified badge. */
  kyc: boolean
  /** Ephemeral stories. */
  stories: boolean
  /** Public reviews / ratings on listings. */
  reviews: boolean
  /** Restrict access to `market.allowedCountries` (IP geo). Off by default —
   *  enable only for a single-country deployment. Bots are always exempt. */
  geoBlock: boolean
  /** Paid add-on; shows checkout/plans + payment CTAs. Off by default. */
  payments: boolean
  /** Editorial + community "Foro" (blog) section. */
  blog: boolean
  /**
   * Credit lifecycle: welcome-credit + purchased-credit expiry emails/writes
   * in the expiring-posts cron. Off by default — with no credits assigned at
   * signup these branches would fire on stale rows. A deployment that runs a
   * credits-per-post model turns it on. Server-only (a cron flag), so no
   * client mirror is needed.
   */
  credits: boolean
}

export type BrandConfig = {
  name: string
  /** Public domain (no scheme). Used in canonical URLs, emails, OG tags. */
  domain: string
  /**
   * Visual palette — the source of truth for theme colors. `layout.tsx` reads
   * these and injects an inline `<style>` on <html> that sets the `--brand-*`
   * CSS variables; every `--v-*` token in globals.css (and the 100+ component
   * usages) is aliased to those, so editing the values here rebrands the whole
   * app — no component CSS to touch.
   *   - primary: accent / call-to-action / highlights → --brand-primary
   *   - dark:    page background in dark mode          → --brand-bg  (.dark)
   *   - light:   page background in light mode         → --brand-bg  (:root)
   * Defaults reproduce the original look; override per deployment.
   */
  colors: { primary: string; dark: string; light: string }
  fonts: { serif: string; sans: string }
}

export type VerticalConfig = {
  /** Slug identifying the vertical (e.g. 'listings', 'services', 'rentals'). */
  id: string
  /**
   * Where the listing taxonomy comes from:
   *   'db'     → read the `categories` table at runtime (no redeploy to
   *              change taxonomy — recommended)
   *   'static' → use the inline `categories` list below
   */
  taxonomySource: 'db' | 'static'
  categories?: { id: string; label: string; order: number }[]
}

export type IntegrationsConfig = {
  cloudinary: { cloud: string; uploadPreset: string; watermarkId?: string }
  payments: { provider: 'mercadopago' | 'stripe' | 'none' }
  concierge: { whatsapp?: string; email?: string }
}

export type BillingPackage = {
  id: string
  /** Credits granted on activation (the engine's fulfilment unit). */
  credits: number
  priceUsd: number
  /** Price in `market.currency` — what the local processor (MercadoPago)
   *  actually charges. Keep in sync with priceUsd at your own FX. */
  priceLocal: number
  label: string
  /**
   * Subscription length this package buys, in days. Activation stamps
   * `user_subscriptions.expires_at = now() + durationDays`, and published
   * posts inherit it as their feed lifetime. Defaults to 30 when omitted.
   */
  durationDays?: number
  /** Admin-gated smoke-test SKUs etc. — hidden from public checkout. */
  adminOnly?: boolean
}

export type BillingConfig = {
  /** Paid-tier catalogue. SERVER-AUTHORITATIVE: routes price from here,
   *  never from request bodies. Edit per deployment. */
  packages: BillingPackage[]
  /**
   * Feed-boost purchase: paid in CREDITS from the buyer's balance (no
   * checkout round-trip). SERVER-AUTHORITATIVE like `packages` — the boost
   * API prices from here, never from the request body. Buying while a boost
   * is active extends `boost_ends_at` from its current end.
   */
  boost: {
    /** Credits deducted per boost purchase. */
    credits: number
    /** Days the boost keeps the post at the top of its tier ordering. */
    durationDays: number
  }
}

export type BlogSectionDef = {
  /** Stored in blog_posts.section — changing ids on a live DB orphans posts. */
  id: string
  label: string
  /** Shown under the section title in the public listing. */
  desc?: string
  /** Only admins may publish into this section. */
  adminOnly?: boolean
  /** Render this section in the public listing (default true). A deployment
   *  running an open community forum lists every section; a curated one can
   *  keep user sections accept-only (posts land but aren't listed). */
  listed?: boolean
}

export type BlogConfig = {
  /** Country slugs the forum answers on (/blog/<slug>). The FIRST entry is
   *  canonical — /blog 308-redirects there and the sitemap uses it as the
   *  fallback for legacy rows without a city. Defaults to the market's
   *  country slug; extend with BLOG_CITY_SLUGS (comma-separated) to keep
   *  legacy aliases resolving. */
  citySlugs: string[]
  /** Forum taxonomy. Deployment config, like billing.packages — edit ids
   *  only on a fresh DB. */
  sections: BlogSectionDef[]
}

export type MarketplaceConfig = {
  brand: BrandConfig
  market: MarketConfig
  features: FeatureFlags
  vertical: VerticalConfig
  integrations: IntegrationsConfig
  billing: BillingConfig
  blog: BlogConfig
}

// ── Active config ────────────────────────────────────────────────────────────
// Everything instance-specific comes from env so this file rarely needs edits.
// Replace the fallback values (after `??`) or set the env vars in `.env.local`.

export const MARKETPLACE: MarketplaceConfig = {
  brand: {
    name: process.env.NEXT_PUBLIC_SITE_NAME ?? 'Foguito',
    domain: process.env.NEXT_PUBLIC_SITE_DOMAIN ?? 'foguito.com',
    // Foguito palette (Noir & Gold → fuego). ember accent, night bg (dark
    // default), warm cream bg (light). Override per deployment via env.
    // These feed the `--brand-*` CSS vars via layout.tsx — see BrandConfig.colors.
    colors: {
      primary: process.env.NEXT_PUBLIC_BRAND_PRIMARY ?? '#FF5330', // ember
      dark:    process.env.NEXT_PUBLIC_BRAND_DARK    ?? '#17101A', // night (default)
      light:   process.env.NEXT_PUBLIC_BRAND_LIGHT   ?? '#FFF6EF', // cream
    },
    fonts: { serif: 'Unbounded', sans: 'DM Sans' },
  },
  market: {
    allowedCountries: (process.env.MARKET_COUNTRY ?? 'US').split(',').map(s => s.trim()).filter(Boolean),
    defaultCountry: (process.env.MARKET_COUNTRY ?? 'US').split(',')[0].trim(),
    defaultCountrySlug: process.env.MARKET_COUNTRY_SLUG ?? 'us',
    currency: process.env.MARKET_CURRENCY ?? 'USD',
    defaultLocale: process.env.MARKET_LOCALE ?? 'en',
    locales: (process.env.MARKET_LOCALES ?? 'en').split(',').map(s => s.trim()).filter(Boolean),
    dialCode: process.env.MARKET_DIAL_CODE ?? '+1',
    flag: process.env.MARKET_FLAG ?? '',
  },
  features: {
    kyc: process.env.FEATURE_KYC === 'true',
    stories: false, // optional add-on — not included in this base
    reviews: false, // optional add-on — not included in this base
    geoBlock: process.env.FEATURE_GEO_BLOCK === 'true',
    payments: process.env.FEATURE_PAYMENTS === 'true',
    blog: false, // not included in this product
    credits: process.env.FEATURE_CREDITS === 'true',
  },
  vertical: {
    id: process.env.MARKETPLACE_VERTICAL ?? 'listings',
    taxonomySource: 'db',
  },
  integrations: {
    cloudinary: {
      cloud: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD ?? '',
      uploadPreset: process.env.NEXT_PUBLIC_CLOUDINARY_PRESET ?? '',
      watermarkId: process.env.NEXT_PUBLIC_CLOUDINARY_WATERMARK_ID,
    },
    payments: { provider: (process.env.PAYMENT_PROVIDER as 'mercadopago' | 'stripe' | 'none') ?? 'none' },
    concierge: {
      whatsapp: process.env.CONCIERGE_WHATSAPP,
      email: process.env.CONCIERGE_EMAIL,
    },
  },
  billing: {
    // Demo catalogue — replace prices/labels for your deployment. priceLocal
    // is in `market.currency`; MercadoPago charges that amount. Each tier is
    // offered in two subscription lengths (monthly / 15 days); the 15-day
    // prices below are placeholders (~60% of monthly) — edit freely, the
    // whole catalogue is deployment config, not product logic.
    packages: [
      { id: 'tier_premium', credits: 49,  priceUsd: 49,  priceLocal: 46550,  durationDays: 30, label: 'Basic — 49 USD/mes' },
      { id: 'tier_plus',   credits: 99,  priceUsd: 99,  priceLocal: 94050,  durationDays: 30, label: 'Bronze — 99 USD/mes' },
      { id: 'tier_pro',   credits: 199, priceUsd: 199, priceLocal: 189050, durationDays: 30, label: 'Silver — 199 USD/mes' },
      { id: 'tier_max',   credits: 399, priceUsd: 399, priceLocal: 379050, durationDays: 30, label: 'Gold — 399 USD/mes' },
      { id: 'tier_elite',   credits: 599, priceUsd: 599, priceLocal: 569050, durationDays: 30, label: 'Elite — 599 USD/mes' },
      { id: 'tier_premium_15d', credits: 29,  priceUsd: 29,  priceLocal: 27550,  durationDays: 15, label: 'Basic — 29 USD/15 días' },
      { id: 'tier_plus_15d',   credits: 59,  priceUsd: 59,  priceLocal: 56050,  durationDays: 15, label: 'Bronze — 59 USD/15 días' },
      { id: 'tier_pro_15d',   credits: 119, priceUsd: 119, priceLocal: 113050, durationDays: 15, label: 'Silver — 119 USD/15 días' },
      { id: 'tier_max_15d',   credits: 239, priceUsd: 239, priceLocal: 227050, durationDays: 15, label: 'Gold — 239 USD/15 días' },
      { id: 'tier_elite_15d',   credits: 359, priceUsd: 359, priceLocal: 341050, durationDays: 15, label: 'Elite — 359 USD/15 días' },
      // Smoke-test SKU — admin-gated in the MP preference route; used to
      // exercise the full pipeline end-to-end with a real card.
      { id: 'tier_test',    credits: 0,   priceUsd: 1,   priceLocal: 1000,   durationDays: 30, label: 'Test — 1 USD', adminOnly: true },
    ],
    // Placeholder cost/length — edit per deployment (deployment config, not
    // product logic).
    boost: { credits: 20, durationDays: 7 },
  },
  blog: {
    citySlugs: [
      ...new Set([
        process.env.MARKET_COUNTRY_SLUG ?? 'us',
        ...(process.env.BLOG_CITY_SLUGS ?? '').split(',').map(s => s.trim()).filter(Boolean),
      ]),
    ],
    // Default taxonomy mirrors the current live shape: an official,
    // admin-only section listed publicly, plus two community sections that
    // accept posts but stay unlisted. An open-forum deployment flips
    // `listed: true` on the community sections.
    sections: [
      { id: 'guias',        label: 'Guías',        desc: 'Publicaciones oficiales de Marketplace', adminOnly: true,  listed: true },
      { id: 'consultas',    label: 'Consultas',    desc: 'Preguntas de la comunidad',              adminOnly: false, listed: false },
      { id: 'experiencias', label: 'Experiencias', desc: 'Historias de la comunidad',              adminOnly: false, listed: false },
    ],
  },
}

export const MARKETPLACE_ID = MARKETPLACE.vertical.id

/** Paid add-on flag (SERVER). When false (default) the payment API routes go
 *  inert and the /pagos + /planes server layouts redirect. Read this in server
 *  code (routes, layouts). `FEATURE_PAYMENTS` is server-only, so
 *  CLIENT components must gate on PAYMENTS_UI_ENABLED instead. */
export const PAYMENTS_ENABLED = MARKETPLACE.features.payments

/** Client mirror of PAYMENTS_ENABLED: `'use client'` components
 *  can't read the server-only FEATURE_PAYMENTS, so the payment UI (gateway
 *  buttons, footer/feed/dashboard CTAs) would never render reliably in the
 *  browser. Gate that UI on this NEXT_PUBLIC_ mirror instead. Keep
 *  NEXT_PUBLIC_PAYMENTS_ENABLED in sync with FEATURE_PAYMENTS at deploy time. */
export const PAYMENTS_UI_ENABLED = process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === 'true'

/** Credit lifecycle flag (SERVER). Gates the welcome-credit + purchased-credit
 *  expiry branches of the expiring-posts cron. Off by default (no credits are
 *  assigned at signup); a credits-per-post deployment turns it on. Read only
 *  in server code — it's a cron flag, no client surface. */
export const CREDITS_ENABLED = MARKETPLACE.features.credits

/** Self-serve renewal (CLIENT mirror). When true, the dashboard's "Renovar"
 *  CTA deep-links into the checkout (/pagos?renew=<post_id>) and the paid
 *  activation extends the post automatically. When false (default) renewals
 *  stay concierge: the CTA opens the renewal form an admin processes
 *  manually. NEXT_PUBLIC_ because the CTA lives in 'use client' components
 *  (server-only envs never reach the browser bundle). */
export const RENEWAL_CHECKOUT_ENABLED = process.env.NEXT_PUBLIC_RENEWAL_CHECKOUT === 'true'

/** Stories / Reviews are optional add-on features. Read these at call sites
 *  to gate the story tray/viewer and the reviews UI. NOTE: FEATURE_STORIES /
 *  FEATURE_REVIEWS are server-only env vars — `'use client'` components can't
 *  read them, so only a config literal reliably reaches the client bundle. */
export const STORIES_ENABLED = MARKETPLACE.features.stories
export const REVIEWS_ENABLED = MARKETPLACE.features.reviews


/** Public-facing country/region label shown in the brand header kicker, the
 *  gateway subtitle and the copyright line. Generic by default so the
 *  boilerplate doesn't hardcode a single market; override per deployment with
 *  NEXT_PUBLIC_COUNTRY_LABEL (e.g. "Argentina", "México"). */
export const COUNTRY_LABEL = process.env.NEXT_PUBLIC_COUNTRY_LABEL ?? 'your area'

/** Client-safe mirrors of server-only market values: MARKET_* are
 *  NOT NEXT_PUBLIC, so `'use client'` components can't read them — they must read
 *  these NEXT_PUBLIC_ mirrors. Keep them in sync with MARKET_COUNTRY_SLUG /
 *  MARKET_CURRENCY at deploy time. Server code should prefer MARKETPLACE.market.* */
export const COUNTRY_SLUG = process.env.NEXT_PUBLIC_COUNTRY_SLUG ?? 'us'
export const MARKET_CURRENCY = process.env.NEXT_PUBLIC_MARKET_CURRENCY ?? 'USD'
/** BCP-47 locale for client-side number/date formatting (`toLocaleString`).
 *  Mirror of MARKET_LOCALE. Use via `src/lib/format.ts` helpers. */
export const DISPLAY_LOCALE = process.env.NEXT_PUBLIC_MARKET_LOCALE ?? 'en'
/** Client mirrors of market.dialCode / market.flag for the phone-country picker. */
export const DIAL_CODE = process.env.NEXT_PUBLIC_MARKET_DIAL_CODE ?? '+1'
export const MARKET_FLAG = process.env.NEXT_PUBLIC_MARKET_FLAG ?? ''
