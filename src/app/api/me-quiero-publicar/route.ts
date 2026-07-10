import { NextResponse } from 'next/server'
import { getResend, ADMIN_EMAIL, MARKETPLACE_FROM as FROM } from '@/lib/clients/resend'
import { renderEmail } from '@/lib/emails'
import { verifyCaptcha } from '@/lib/auth/verify-captcha'

export const runtime = 'nodejs'

interface Payload {
  nombre: string
  ciudad: string
  whatsapp: string
  correo: string
  tier: string
  metodo_pago: string
  notas?: string
  captcha_token?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export async function POST(req: Request) {
  try {
    const resend = getResend()
    const body: Payload = await req.json()
    const { nombre, ciudad, whatsapp, correo, tier, metodo_pago, notas, captcha_token } = body

    if (!nombre?.trim() || !ciudad?.trim() || !whatsapp?.trim() || !correo?.trim() || !tier?.trim()) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
    }

    // Preserve the legacy "accept if no captcha secret configured" behavior
    // so local dev without TURNSTILE_SECRET / HCAPTCHA_SECRET still lets
    // form submissions land. Production always has a secret set.
    const result = await verifyCaptcha(captcha_token)
    if (!result.ok && result.reason !== 'no-secret-configured') {
      return NextResponse.json({ error: 'Captcha inválido' }, { status: 400 })
    }

    const subject = `Nueva solicitud — ${escapeHtml(nombre)} (${escapeHtml(tier)})`
    const adminHtml = renderEmail(`
      <h2 style="color:#2563EB;margin:0 0 18px">Nueva solicitud — Me quiero publicar</h2>
      <p><b>Nombre:</b> ${escapeHtml(nombre)}</p>
      <p><b>Ciudad:</b> ${escapeHtml(ciudad)}</p>
      <p><b>WhatsApp:</b> ${escapeHtml(whatsapp)}</p>
      <p><b>Correo:</b> ${escapeHtml(correo)}</p>
      <p><b>Tier:</b> ${escapeHtml(tier)}</p>
      <p><b>Pago preferido:</b> ${escapeHtml(metodo_pago)}</p>
      ${notas ? `<p><b>Notas:</b></p><p style="background:#0f0f0f;padding:14px;border-left:3px solid #2563EB">${escapeHtml(notas)}</p>` : ''}
    `)
    const userHtml = renderEmail(`
      <h2 style="color:#2563EB;margin:0 0 18px">Recibimos tu solicitud</h2>
      <p>Hola ${escapeHtml(nombre)}, recibimos tu solicitud de publicación. Nuestro equipo se contactará en las próximas horas para coordinar los siguientes pasos.</p>
      <p style="margin-top:18px"><b>Tu solicitud:</b></p>
      <p>Tier: ${escapeHtml(tier)}<br/>Ciudad: ${escapeHtml(ciudad)}<br/>Pago: ${escapeHtml(metodo_pago)}</p>
      <p style="margin-top:24px;color:#2563EB">— Equipo Marketplace</p>
    `)

    // Send admin notification + user copy in parallel
    await Promise.all([
      resend.emails.send({ from: FROM, to: ADMIN_EMAIL, replyTo: correo, subject, html: adminHtml }),
      resend.emails.send({ from: FROM, to: correo, subject: 'Recibimos tu solicitud — Marketplace', html: userHtml }),
    ])

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[me-quiero-publicar] error:', err)
    return NextResponse.json({ error: 'Error al enviar la solicitud' }, { status: 500 })
  }
}
