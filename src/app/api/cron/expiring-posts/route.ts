import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { getResend } from '@/lib/clients/resend'
import { renderEmail, FROM } from '@/lib/emails'
import { whatsappUrl, whatsappRenewalMessage } from '@/lib/concierge'
import { CREDITS_ENABLED } from '@/config/marketplace.config'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

// Canonical domain for email links. Fallback preserved for local dev.
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://example.com'

// Local alias — all email bodies in this cron go through the shared
// Marketplace shell (logo footer + brand styling).
const emailWrap = renderEmail

function accentButton(href: string, label: string) {
  return `<a href="${href}" style="background:#2563EB;color:#000;padding:12px 24px;text-decoration:none;border-radius:2px;display:inline-block;font-size:13px;margin-top:16px">${label}</a>`
}

function whatsappButton(message: string, label = 'ESCRIBINOS POR WHATSAPP'): string {
  const url = whatsappUrl(message)
  if (!url) return ''
  return `<a href="${url}" style="background:transparent;color:#2563EB;padding:12px 24px;text-decoration:none;border-radius:2px;display:inline-block;font-size:13px;margin-top:10px;border:1px solid #2563EB">${label}</a>`
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const resend = getResend()
  const now = new Date()
  const stats = { postReminders: 0, welcomeExpired: 0, creditsExpired: 0, creditsWarned: 0, post5d: 0, post1d: 0, expiryAudited: 0 }

  // Credit-expiry branches below are gated by the deployment-level
  // `FEATURE_CREDITS` flag (CREDITS_ENABLED, imported from the config). Off by
  // default; a deployment running a credits-per-post model sets
  // FEATURE_CREDITS=true. See the restore checklist above the branches.

  // Helper to send email safely
  async function sendEmail(to: string, subject: string, html: string) {
    try {
      await resend.emails.send({ from: FROM, to, subject, html })
      return true
    } catch (err) {
      console.error(`Email failed to ${to}:`, err)
      return false
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 1. POST EXPIRY REMINDERS — 5d, 1d
  // ══════════════════════════════════════════════════════════════
  const intervals = [
    { days: 5, field: 'notified_5d', subject: 'Tu plan vence en 5 días — Marketplace', urgent: false },
    { days: 1, field: 'notified_1d', subject: '⚠️ Tu plan vence mañana — Marketplace', urgent: true },
  ] as const

  for (const interval of intervals) {
    const rangeFrom = new Date(now.getTime() + (interval.days - 1) * 86400000)
    const rangeTo = new Date(now.getTime() + interval.days * 86400000)

    const { data: posts } = await supabase
      .from('posts')
      .select('id, name, title, user_id, expires_at, profiles(email, full_name)')
      .eq('status', 'published')
      .eq(interval.field, false)
      .gte('expires_at', rangeFrom.toISOString())
      .lte('expires_at', rangeTo.toISOString())

    for (const post of posts || []) {
      // `profiles(email, full_name)` is typed as array in Supabase; pick first.
      const profRel = (post as { profiles?: { email?: string; full_name?: string } | { email?: string; full_name?: string }[] }).profiles
      const profile = Array.isArray(profRel) ? profRel[0] : profRel
      const email = profile?.email
      if (!email) continue
      const userName = profile?.full_name?.split(' ')[0] || 'estimada'
      const postName = post.name || post.title || 'tu publicación'

      // Concierge renewal URL — /publicar form pre-filled with the post
      // reference via query params. WhatsApp button below as the
      // lower-friction channel (admin replies directly, no form). Email
      // clients render wa.me links fine.
      const renewalUrl = `${BASE_URL}/publicar?tipo=renovacion&post_id=${post.id}&origen=email-expiry`
      const waBtn = whatsappButton(whatsappRenewalMessage({ postTitle: postName, postId: post.id }))

      const body = interval.urgent
        ? emailWrap(`
            <h2 style="color:#2563EB;font-size:20px;margin-bottom:16px">Hola ${userName} ✨</h2>
            <p style="font-size:14px;line-height:1.8;color:#E2E8F0">
              Te escribimos para recordarte que tu plan está próximo a vencer <b>mañana</b>.
            </p>
            <p style="font-size:14px;line-height:1.8;color:#E2E8F0">
              Para que puedas mantener tu visibilidad y posicionamiento dentro de la plataforma sin interrupciones,
              te recomendamos gestionar la renovación con anticipación.
            </p>
            <p style="font-size:14px;line-height:1.8;color:#E2E8F0">
              Modo concierge: nuestro equipo procesa la renovación manualmente en menos de 24 h tras recibir tu solicitud.
            </p>
            ${accentButton(renewalUrl, 'RENOVAR AHORA')}
            ${waBtn}
            <p style="font-size:13px;color:#787068;margin-top:24px">Quedamos atentos!<br/>Marketplace</p>
          `)
        : emailWrap(`
            <h2 style="color:#2563EB;font-size:20px;margin-bottom:16px">Hola ${userName} ✨</h2>
            <p style="font-size:14px;line-height:1.8;color:#E2E8F0">
              Te escribimos para recordarte que tu plan está próximo a vencer en <b>${interval.days} días</b>.
            </p>
            <p style="font-size:14px;line-height:1.8;color:#E2E8F0">
              Para que puedas mantener tu visibilidad y posicionamiento dentro de la plataforma sin interrupciones,
              te recomendamos gestionar la renovación con anticipación.
            </p>
            <p style="font-size:14px;line-height:1.8;color:#E2E8F0">
              Modo concierge: nuestro equipo procesa la renovación manualmente en menos de 24 h tras recibir tu solicitud.
            </p>
            ${accentButton(renewalUrl, 'RENOVAR AHORA')}
            ${waBtn}
            <p style="font-size:13px;color:#787068;margin-top:24px">Quedamos atentos!<br/>Marketplace</p>
          `)

      if (await sendEmail(email, interval.subject, body)) {
        await supabase.from('posts').update({ [interval.field]: true }).eq('id', post.id)
        if (interval.days === 5) stats.post5d++
        else stats.post1d++
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 1b. EXPIRY AUDIT — one audit_log row per crossed expiry
  // ══════════════════════════════════════════════════════════════
  // Expiry itself is passive (the feed filters on expires_at; no status
  // change happens), so without this there is no durable record of WHEN a
  // publication fell out of the feed. `expiry_audited` is the bookkeeping
  // flag (same pattern as notified_5d/1d); the posts_rearm_expiry_audit
  // trigger resets it whenever expires_at gets extended (renewal/unpause),
  // so each expiry window gets exactly one event. recordAudit is
  // fire-and-forget by design (a transient audit failure never blocks the
  // cron), so the flag is only stamped after the call resolves.
  const { data: justExpired } = await supabase
    .from('posts')
    .select('id, user_id, expires_at')
    .eq('status', 'published')
    .eq('expiry_audited', false)
    .lt('expires_at', now.toISOString())
    .limit(500)

  for (const post of justExpired || []) {
    await recordAudit({
      eventType: 'post_expired',
      actorRole: 'system',
      subjectType: 'post',
      subjectId: post.id,
      metadata: {
        post_owner_user_id: post.user_id,
        expired_at: post.expires_at,
      },
    })
    await supabase.from('posts').update({ expiry_audited: true }).eq('id', post.id)
    stats.expiryAudited++
  }

  // ══════════════════════════════════════════════════════════════
  // CREDIT-EXPIRY BRANCHES (paused in cold-start / concierge 100%)
  // ══════════════════════════════════════════════════════════════
  // Credit emails + DB writes are paused while Marketplace is in concierge
  // mode — admin creates accounts manually, no credits are assigned via
  // signup, so these branches would either fire on stale legacy rows or
  // never fire at all. Gated by the `CREDITS_ENABLED` deployment flag
  // (FEATURE_CREDITS) instead of deleted so the restore path stays visible:
  //   1. Set `FEATURE_CREDITS=true` in the deployment env.
  //   2. Restore `sendCreditsEmpty` helper in src/lib/emails.ts.
  //   3. Re-enable welcome_credit writes in src/app/registro/page.tsx
  //      and src/app/auth/confirm/page.tsx (see PR #17 for the removed
  //      shape).
  //   4. Re-expose credit balance UI (UserHeader / dashboard panels,
  //      CreditBadge component) — see the credit-cleanup PRs where
  //      they were hidden.
  // See also: /CLAUDE.md concierge-model section.

  // 2. WELCOME CREDIT EXPIRY (7 days)
  if (CREDITS_ENABLED) {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
    const { data: welcomeExpired } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('welcome_credit_assigned', true)
      .eq('welcome_credit_expired', false)
      .gte('credits', 1)
      .lte('welcome_credit_assigned_at', sevenDaysAgo)

    if (welcomeExpired && welcomeExpired.length > 0) {
      const ids = welcomeExpired.map(p => p.id)
      await supabase.from('profiles').update({ credits: 0, welcome_credit_expired: true }).in('id', ids)

      for (const p of welcomeExpired) {
        if (p.email && await sendEmail(p.email, 'Tu crédito de bienvenida venció — Marketplace',
          emailWrap(`<h2 style="color:#2563EB">Crédito de Bienvenida Expirado</h2><p>Tu crédito gratuito ha expirado.</p><p>Compra créditos para comenzar a publicar.</p>${accentButton(BASE_URL + '/pagos', 'COMPRAR CRÉDITOS')}`)))
          stats.welcomeExpired++
      }
    }
  }

  // 3. PURCHASED CREDITS EXPIRY (3 months)
  if (CREDITS_ENABLED) {
    const threeMonthsAgo = new Date(now.getTime() - 90 * 86400000).toISOString()
    const { data: creditExpired } = await supabase
      .from('profiles')
      .select('id, email, credits')
      .gt('credits', 0)
      .eq('welcome_credit_assigned', false)
      .lte('credits_purchased_at', threeMonthsAgo)

    if (creditExpired && creditExpired.length > 0) {
      const ids = creditExpired.map(p => p.id)
      await supabase.from('profiles').update({ credits: 0 }).in('id', ids)

      for (const p of creditExpired) {
        if (p.email && await sendEmail(p.email, 'Tus créditos Marketplace han vencido',
          emailWrap(`<h2 style="color:#2563EB">Créditos Vencidos</h2><p>Tus <b>${p.credits}</b> créditos no utilizados han expirado después de 3 meses.</p><p>Recarga para seguir publicando.</p>${accentButton(BASE_URL + '/pagos', 'RECARGAR CRÉDITOS')}`)))
          stats.creditsExpired++
      }
    }
  }

  // 4. CREDITS 30-DAY WARNING (2 months purchased, not yet warned)
  if (CREDITS_ENABLED) {
    const threeMonthsAgo = new Date(now.getTime() - 90 * 86400000).toISOString()
    const twoMonthsAgo = new Date(now.getTime() - 60 * 86400000).toISOString()
    const { data: creditWarn } = await supabase
      .from('profiles')
      .select('id, email, credits, credits_purchased_at')
      .gt('credits', 0)
      .eq('welcome_credit_assigned', false)
      .eq('credits_expiry_notified', false)
      .lte('credits_purchased_at', twoMonthsAgo)
      .gt('credits_purchased_at', threeMonthsAgo)

    if (creditWarn && creditWarn.length > 0) {
      for (const p of creditWarn) {
        if (!p.email || !p.credits_purchased_at) continue
        const expiryDate = new Date(new Date(p.credits_purchased_at).getTime() + 90 * 86400000).toLocaleDateString('es-CL')
        if (await sendEmail(p.email, 'Tus créditos Marketplace vencen en 30 días',
          emailWrap(`<h2 style="color:#2563EB">Tus créditos están por vencer</h2><p>Tienes <b>${p.credits} créditos</b> que vencerán el <b>${expiryDate}</b>.</p><p>Úsalos antes de que expiren.</p>${accentButton(BASE_URL + '/dashboard', 'IR AL PANEL')}`))) {
          await supabase.from('profiles').update({ credits_expiry_notified: true }).eq('id', p.id)
          stats.creditsWarned++
        }
      }
    }
  }

  return Response.json({ success: true, stats }, { status: 200 })
}
