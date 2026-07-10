import { Resend } from 'resend'
import { MARKETPLACE } from '@/config/marketplace.config'

/**
 * Resend singleton + helper for server-side routes.
 *
 * Before this, every email send in every route did `new Resend(...)` — a
 * fresh client + TLS handshake per request. Now we reuse one instance per
 * worker and expose `sendEmail()` to standardize the `from:` header across
 * the whole app.
 */

let cached: Resend | null = null

export function getResend(): Resend {
  if (cached) return cached
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('[resend] RESEND_API_KEY is not set')
  cached = new Resend(key)
  return cached
}

// Email identities are env-driven so a deployment never ships a literal
// placeholder address. `EMAIL_FROM` is the full RFC-5322 From header (with
// display name); when unset we derive a sensible `noreply@<brand domain>`
// from the marketplace config. `ADMIN_EMAIL` is where internal copies/alerts
// go; `EMAIL_REPLY_TO` is the user-facing reply address (concierge inbox).
//
// Verify your sending domain in Resend (DKIM + return-path/SPF) before going
// live — DMARC alignment requires the From domain to match the verified one.
const BRAND_NAME   = MARKETPLACE.brand.name || 'Marketplace'
const BRAND_DOMAIN = MARKETPLACE.brand.domain || 'localhost'

export const MARKETPLACE_FROM =
  process.env.EMAIL_FROM || `${BRAND_NAME} <noreply@${BRAND_DOMAIN}>`
export const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || MARKETPLACE.integrations.concierge.email || `admin@${BRAND_DOMAIN}`
export const REPLY_TO =
  process.env.EMAIL_REPLY_TO || MARKETPLACE.integrations.concierge.email || `contacto@${BRAND_DOMAIN}`

interface SendEmailArgs {
  to: string | string[]
  subject: string
  html: string
  /** Override `from` for the rare case a different identity is needed. */
  from?: string
  /** Override the default Reply-To (e.g. forward user-submitted contact
   *  forms back to the original sender). Defaults to `REPLY_TO`. */
  replyTo?: string
}

/**
 * Fire-and-log wrapper around Resend. Returns the Resend response (or null on
 * failure) so callers can react, but never throws — email failures never
 * break webhooks or payment flows.
 */
export async function sendEmail({ to, subject, html, from, replyTo }: SendEmailArgs) {
  try {
    const resend = getResend()
    const res = await resend.emails.send({
      from: from ?? MARKETPLACE_FROM,
      replyTo: replyTo ?? REPLY_TO,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    })
    return res
  } catch (err) {
    console.error('[resend] send failed:', { subject, to, err })
    return null
  }
}
