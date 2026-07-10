import { MARKETPLACE } from '@/config/marketplace.config'

/**
 * Concierge helpers — WhatsApp URL builder + canned messages.
 *
 * Payment activation is automatic now (webhook-driven): these channels are
 * SUPPORT affordances only — help/renewal/troubleshooting — not the path that
 * activates a paid subscription. The primary low-friction channel is WhatsApp;
 * the mail fallback stays for users who prefer async. Centralizing the contact
 * string here means one place to change when the concierge number rotates.
 *
 * Future: once Facebook Business Portfolio approval lands, the
 * one-off wa.me links get supplemented by an automated WhatsApp
 * Business API integration for scheduled reminders (post expiry,
 * activation confirmation). That work will hang off this module —
 * see the backlog entry in memory/project_deploy_state.md.
 */

/** Centralized concierge WhatsApp number. Env-driven so it rotates
 *  without a code change. `NEXT_PUBLIC_` prefix → readable in client
 *  components; the number is public anyway (it renders in CTAs). */
export const CONCIERGE_WHATSAPP = (process.env.NEXT_PUBLIC_CONCIERGE_WHATSAPP || '').trim()

/** Centralized concierge Telegram handle/number. Accepts either a
 *  `@username` / `username` string or an international phone (with
 *  or without leading `+`). The {@link telegramUrl} helper normalizes
 *  to the right `t.me` form. */
export const CONCIERGE_TELEGRAM = (process.env.NEXT_PUBLIC_CONCIERGE_TELEGRAM || '').trim()

/** Admin contact email — mail fallback when WhatsApp isn't the right
 *  fit for the user. */
export const CONCIERGE_EMAIL = MARKETPLACE.integrations.concierge.email || ''

/**
 * Build a `https://wa.me/...` link with an optional pre-filled message.
 * Strips non-digit chars (plus signs, spaces, hyphens) from the number
 * because wa.me expects the raw international form.
 * Returns an empty string if the env var isn't set — callers should
 * guard with a truthy check and fall back to the mail link.
 */
export function whatsappUrl(message?: string): string {
  const digits = CONCIERGE_WHATSAPP.replace(/\D/g, '')
  if (!digits) return ''
  const suffix = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${digits}${suffix}`
}

/** Canned renewal message — used by dashboard Renovar CTAs + the
 *  post-expiry cron emails. Includes a short post reference when the
 *  caller has one so the admin doesn't have to ask which publication. */
export function whatsappRenewalMessage(opts: { postTitle?: string | null; postId?: string | null }): string {
  const { postTitle, postId } = opts
  const ref = postTitle
    ? ` "${postTitle}"`
    : postId
      ? ` (ref: ${postId.slice(0, 8)})`
      : ''
  return `Hola, quiero renovar mi publicación${ref}. ¿Me indican los pasos?`
}

/** Generic support message — used from the Concierge banner / generic
 *  "Contactar" CTAs when there's no specific context. */
export function whatsappSupportMessage(): string {
  return 'Hola, quiero hablar con el equipo de Marketplace sobre mi publicación.'
}

/**
 * Build a `https://t.me/...` link for the concierge Telegram channel.
 * Accepts two input forms in `CONCIERGE_TELEGRAM`:
 *   - `@username` or `username` → `https://t.me/username`
 *   - `+5491126783554` (or `5491126783554`) → `https://t.me/+5491126783554`
 *     (Telegram's phone-based "find by phone" deep-link)
 * Returns an empty string if the env var isn't set — callers should
 * conditionally render the button based on truthiness.
 */
export function telegramUrl(): string {
  const v = CONCIERGE_TELEGRAM
  if (!v) return ''
  const trimmed = v.replace(/^@/, '').trim()
  // Phone form: digits-only, optionally prefixed with `+`, with optional
  // spaces/hyphens as visual separators. Normalize to `+<digits>` per t.me.
  if (/^\+?\d[\d\s-]*$/.test(trimmed)) {
    return `https://t.me/+${trimmed.replace(/\D/g, '')}`
  }
  return `https://t.me/${trimmed}`
}
