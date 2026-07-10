// ─────────────────────────────────────────────────────────────────────────────
// Shared content for the legal TEMPLATE pages (/terminos, /privacidad).
// ─────────────────────────────────────────────────────────────────────────────
//
// These pages are brand-neutral, vertical-neutral, jurisdiction-light TEMPLATES.
// Brand / company / contact values are interpolated from the marketplace config
// (env-driven) with neutral fallbacks so an unconfigured deployment still renders
// readable, generic legal copy instead of leaking placeholder brand names.
//
// IMPORTANT: this is a starting point, not legal advice. Each deployment must
// review and adapt the text with its own counsel before operating.

import { MARKETPLACE } from '@/config/marketplace.config'

export type LegalIdentity = {
  /** Display name of the operating company / brand. */
  brand: string
  /** Public domain (no scheme), used in URLs and copy. */
  domain: string
  /** Contact email for legal / privacy enquiries. */
  email: string
  /** ISO year for "last updated" lines, computed at render time. */
  year: number
}

/**
 * Resolve the brand/company identity for the legal pages from config, falling
 * back to neutral placeholders when a deployment hasn't set the relevant env
 * vars. Fallbacks are deliberately generic Spanish placeholders so the template
 * never ships another deployment's brand name.
 */
export function getLegalIdentity(): LegalIdentity {
  const rawName = MARKETPLACE.brand.name?.trim()
  const rawDomain = MARKETPLACE.brand.domain?.trim()
  const rawEmail = MARKETPLACE.integrations.concierge.email?.trim()

  // Treat the config's own demo defaults as "unset" so the legal template
  // shows neutral placeholders rather than "Marketplace" / "example.com".
  const brand =
    rawName && rawName.toLowerCase() !== 'marketplace'
      ? rawName
      : '[Nombre de tu empresa]'

  const domain =
    rawDomain && rawDomain.toLowerCase() !== 'example.com'
      ? rawDomain
      : 'tu-dominio.com'

  const email =
    rawEmail && rawEmail.length > 0
      ? rawEmail
      : `contacto@${domain === 'tu-dominio.com' ? 'tu-dominio.com' : domain}`

  return {
    brand,
    domain,
    email,
    year: new Date().getFullYear(),
  }
}

/** Disclaimer banner copy shown atop every legal template page. */
export const LEGAL_TEMPLATE_NOTICE =
  'Plantilla legal — revisá y adaptá este texto con tu asesor legal antes de operar. No constituye asesoramiento legal.'
