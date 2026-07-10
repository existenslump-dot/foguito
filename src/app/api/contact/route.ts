import { getResend } from '@/lib/clients/resend'
import { ContactSchema, validationError } from '@/lib/validation/schemas'
import { renderEmail } from '@/lib/emails'
import { verifyCaptcha } from '@/lib/auth/verify-captcha'

export async function POST(req: Request) {
  try {
    const resend = getResend()
    const parsed = ContactSchema.safeParse(await req.json())
    if (!parsed.success) {
      return Response.json(validationError(parsed.error), { status: 400 })
    }
    const { nombre, correo, email, asunto, mensaje, captchaToken } = parsed.data

    // Captcha gate. verifyCaptcha returns 'no-secret-configured' when no
    // TURNSTILE_SECRET/HCAPTCHA_SECRET is set — accept that as "dev mode,
    // captcha disabled". In prod, secrets are always set, so a missing or
    // invalid token blocks the spam path that #97 of the contact-form
    // audit flagged (frontend was showing the widget but the token never
    // reached the backend).
    const cap = await verifyCaptcha(captchaToken)
    if (!cap.ok && cap.reason !== 'no-secret-configured') {
      return Response.json({ error: 'Captcha inválido o expirado' }, { status: 400 })
    }

    // Schema refine guarantees at least one of (correo, email) is present,
    // but TS can't narrow through .refine() so we assert here.
    const senderEmail = (correo || email)!

    await resend.emails.send({
      from: 'Marketplace <noreply@example.com>',
      to: 'admin@example.com',
      replyTo: senderEmail,
      subject: `Nueva consulta — ${asunto || 'Sin asunto'}`,
      html: renderEmail(`
        <h2 style="color:#2563EB">Nueva consulta desde Marketplace</h2>
        <p><b>Nombre:</b> ${escapeHtml(nombre)}</p>
        <p><b>Email:</b> ${escapeHtml(senderEmail)}</p>
        <p><b>Asunto:</b> ${escapeHtml(asunto || 'Sin asunto')}</p>
        <p><b>Mensaje:</b></p>
        <p style="background:#0f0f0f;padding:16px;border-left:3px solid #2563EB">
          ${escapeHtml(mensaje)}
        </p>
      `),
    })

    return Response.json({ success: true }, { status: 200 })
  } catch (err) {
    console.error('Resend error:', err)
    return Response.json({ error: 'Error al enviar' }, { status: 500 })
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
