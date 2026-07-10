import { Resend } from 'resend'
import { whatsappUrl, whatsappRenewalMessage } from '@/lib/concierge'
import { MARKETPLACE_FROM, REPLY_TO as RESEND_REPLY_TO } from '@/lib/clients/resend'
import { MARKETPLACE } from '@/config/marketplace.config'

const resend = new Resend(process.env.RESEND_API_KEY || 're_placeholder_build_only')

// Email identities — env-driven via clients/resend.ts (EMAIL_FROM /
// EMAIL_REPLY_TO with a brand-domain fallback). No literal placeholder domain.
export const FROM     = MARKETPLACE_FROM
export const REPLY_TO = RESEND_REPLY_TO

const BRAND_DOMAIN = MARKETPLACE.brand.domain || 'localhost'
const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || `https://${BRAND_DOMAIN}`).replace(/\/$/, '')

/**
 * Wraps body HTML in the standard Marketplace email shell (dark background,
 * accent colors, logo footer). Email clients ignore external stylesheets so
 * all styling must be inline. Images need absolute URLs — relative paths
 * break in most clients (Gmail proxies, Outlook, etc.).
 */
export function renderEmail(bodyHtml: string): string {
  return `
    <div style="font-family:Arial,sans-serif;background:#0F172A;color:#E2E8F0;padding:32px;max-width:600px;margin:0 auto;">
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid rgba(37, 99, 235,0.15);margin:32px 0 16px;" />
      <div style="text-align:center;padding-top:8px;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:500;letter-spacing:0.18em;line-height:1;color:#E2E8F0;">
          ${MARKETPLACE.brand.name.toUpperCase()}<span style="color:${MARKETPLACE.brand.colors.primary};">&#160;&#10022;</span>
        </div>
        <p style="font-family:Arial,sans-serif;font-size:10px;color:rgba(224,216,192,0.4);letter-spacing:.18em;text-transform:uppercase;margin:12px 0 0;">
          <a href="${BASE_URL}" style="color:rgba(224,216,192,0.5);text-decoration:none;">${BRAND_DOMAIN}</a>
        </p>
      </div>
    </div>
  `
}

/** Send an email with the standard Marketplace shell applied. */
export async function sendMarketplaceEmail(opts: { to: string; subject: string; bodyHtml: string }) {
  await resend.emails.send({
    from:    FROM,
    replyTo: REPLY_TO,
    to:      opts.to,
    subject: opts.subject,
    html:    renderEmail(opts.bodyHtml),
  })
}

export async function sendPostPublished(email: string, postName: string, postUrl: string) {
  await sendMarketplaceEmail({
    to:      email,
    subject: `Tu anuncio fue publicado — Marketplace`,
    bodyHtml: `
      <h2 style="color:#2563EB;font-family:Arial,sans-serif;">Anuncio Publicado</h2>
      <p>Tu anuncio <b>${postName}</b> ya está visible en Marketplace.</p>
      <p><a href="${postUrl}" style="color:#2563EB">Ver anuncio →</a></p>
    `,
  })
}

export async function sendPostExpiring(email: string, postName: string, daysLeft: number) {
  // Concierge mode: renewal no longer self-service. Points at /publicar
  // (concierge form) plus a WhatsApp link when the env var is set; the
  // cron (expiring-posts) uses its own richer inline template, but this
  // helper stays up-to-date for any ad-hoc caller.
  const waLink = whatsappUrl(whatsappRenewalMessage({ postTitle: postName }))
  const waSpan = waLink
    ? ` o por <a href="${waLink}" style="color:#2563EB">WhatsApp</a>`
    : ''
  await sendMarketplaceEmail({
    to:      email,
    subject: `Tu anuncio expira en ${daysLeft} días — Marketplace`,
    bodyHtml: `
      <h2 style="color:#2563EB;font-family:Arial,sans-serif;">Anuncio por Expirar</h2>
      <p>Tu anuncio <b>${postName}</b> expira en ${daysLeft} días.</p>
      <p>Para renovarlo, escribinos por <a href="${BASE_URL}/publicar?tipo=renovacion" style="color:#2563EB">formulario</a>${waSpan} y nuestro equipo activa la renovación en menos de 24 h.</p>
    `,
  })
}

// `sendCreditsEmpty` removed — credits system is paused in cold-start
// (concierge 100%). Restore alongside the matching cron branches in
// /api/cron/expiring-posts/route.ts when self-service credits reactivate.

export async function sendStoryStatus(email: string, status: 'approved' | 'rejected', reason?: string) {
  const isApproved = status === 'approved'
  await sendMarketplaceEmail({
    to:      email,
    subject: `Tu historia fue ${isApproved ? 'aprobada' : 'rechazada'} — Marketplace`,
    bodyHtml: `
      <h2 style="color:${isApproved ? '#2563EB' : '#e05555'};font-family:Arial,sans-serif;">${isApproved ? 'Historia Aprobada' : 'Historia Rechazada'}</h2>
      <p>Tu historia fue ${isApproved ? 'aprobada y ya es visible' : 'rechazada'}.</p>
      ${reason ? `<p><b>Motivo:</b> ${reason}</p>` : ''}
    `,
  })
}
