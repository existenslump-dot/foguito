import { sendEmail, REPLY_TO, MARKETPLACE_FROM } from '@/lib/clients/resend'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://example.com').replace(/\/$/, '')

function renderReviewEmail(args: {
  headerTitle: string
  bodyHtml:    string
  disclaimer?: string
}): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${args.headerTitle} — Marketplace</title>
</head>
<body style="margin:0;padding:0;background:#0F172A;font-family:Georgia,'Times New Roman',serif;color:#E2E8F0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0F172A;padding:48px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#0e0e0e;border:1px solid rgba(37, 99, 235,0.18);border-radius:8px;padding:40px 32px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:0.08em;color:#2563EB;font-weight:500;">Marketplace</div>
              <div style="height:1px;background:linear-gradient(90deg,transparent,#2563EB 40%,#d4b574 60%,transparent);margin:14px auto 0;width:80%;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 22px;font-family:Georgia,serif;font-size:22px;line-height:1.3;color:#E2E8F0;text-align:center;font-weight:400;">
              ${args.headerTitle}
            </td>
          </tr>
          ${args.bodyHtml}
          <tr>
            <td style="border-top:1px solid rgba(37, 99, 235,0.12);padding-top:20px;font-family:Helvetica,Arial,sans-serif;font-size:10px;line-height:1.6;color:rgba(234,228,216,0.4);text-align:center;">
              ${args.disclaimer || 'Marketplace NUNCA pide DNI, fotos ni contraseña por correo, WhatsApp o Instagram.'}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:24px;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(234,228,216,0.35);">
              example.com
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function ctaButton(href: string, label: string): string {
  return `<tr>
    <td align="center" style="padding:0 0 28px;">
      <a href="${href}" style="display:inline-block;background:#2563EB;color:#FFFFFF;text-decoration:none;padding:14px 36px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">
        ${label}
      </a>
    </td>
  </tr>`
}

function bodyParagraph(text: string): string {
  return `<tr>
    <td style="padding:0 0 28px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:rgba(234,228,216,0.7);text-align:center;">
      ${text}
    </td>
  </tr>`
}

export async function sendOwnerNewPendingReview(args: {
  ownerEmail: string
  postTitle:  string
}): Promise<void> {
  if (!args.ownerEmail) return
  const cta = `${APP_URL}/dashboard/reviews`
  const body = bodyParagraph(
    `Recibiste una nueva reseña en tu publicación <strong style="color:#E2E8F0;">"${escapeHtml(args.postTitle)}"</strong>. Pasó la revisión de Marketplace y ahora podés decidir si la mostrás en tu perfil.`,
  ) + ctaButton(cta, 'Ver reseñas pendientes')
  await sendEmail({
    to:      args.ownerEmail,
    from:    MARKETPLACE_FROM,
    replyTo: REPLY_TO,
    subject: 'Tenés una reseña pendiente — Marketplace ✦',
    html:    renderReviewEmail({
      headerTitle: 'Nueva reseña pendiente',
      bodyHtml: body,
      disclaimer: 'Marketplace valida primero las reseñas para asegurar que no expongan información sensible. Vos decidís cuáles aparecen en tu perfil.',
    }),
  })
}

export async function sendReviewerAdminApproved(args: {
  reviewerEmail: string
  postTitle:     string
}): Promise<void> {
  if (!args.reviewerEmail) return
  const body = bodyParagraph(
    `Tu reseña sobre <strong style="color:#E2E8F0;">"${escapeHtml(args.postTitle)}"</strong> pasó la revisión de Marketplace. Ahora la anunciante decide si la muestra en su perfil.`,
  ) + bodyParagraph(
    `Te avisaremos solo si hay una novedad importante.`,
  )
  await sendEmail({
    to:      args.reviewerEmail,
    from:    MARKETPLACE_FROM,
    replyTo: REPLY_TO,
    subject: 'Tu reseña pasó la revisión — Marketplace ✦',
    html:    renderReviewEmail({
      headerTitle: 'Tu reseña fue aprobada',
      bodyHtml: body,
      disclaimer: 'Marketplace NUNCA pide DNI, fotos ni contraseña por correo, WhatsApp o Instagram.',
    }),
  })
}

export async function sendReviewerAdminRejected(args: {
  reviewerEmail: string
  postTitle:     string
  reason?:       string
}): Promise<void> {
  if (!args.reviewerEmail) return
  const reasonBlock = args.reason
    ? bodyParagraph(`<em style="color:rgba(234,228,216,0.55);">Motivo:</em> ${escapeHtml(args.reason)}`)
    : ''
  const body = bodyParagraph(
    `No pudimos publicar tu reseña sobre <strong style="color:#E2E8F0;">"${escapeHtml(args.postTitle)}"</strong>.`,
  ) + reasonBlock + bodyParagraph(
    `Si querés, podés enviar otra reseña respetando las normas: no datos personales, no contacto fuera de plataforma, no contenido ilegal.`,
  )
  await sendEmail({
    to:      args.reviewerEmail,
    from:    MARKETPLACE_FROM,
    replyTo: REPLY_TO,
    subject: 'No pudimos publicar tu reseña — Marketplace ✦',
    html:    renderReviewEmail({
      headerTitle: 'Tu reseña no fue publicada',
      bodyHtml: body,
      disclaimer: 'Marketplace rechaza reseñas que contengan datos personales (teléfono, DNI, email, dirección, datos bancarios) o contenido ilegal.',
    }),
  })
}

export async function sendAdminPatternAlert(args: {
  adminEmail: string
  patterns:   Array<{ postId: string; postTitle: string; subnet: string; count: number; window: string }>
}): Promise<void> {
  if (!args.adminEmail || args.patterns.length === 0) return
  const rows = args.patterns.map(p => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-family:Helvetica,Arial,sans-serif;font-size:12px;color:rgba(234,228,216,0.75);">
        <strong style="color:#E2E8F0;">${escapeHtml(p.postTitle)}</strong><br>
        <span style="color:rgba(234,228,216,0.5);font-size:11px;">
          ${p.count} reseñas anon desde ${p.subnet} en ${p.window}
        </span><br>
        <a href="${APP_URL}/admin" style="color:#2563EB;font-size:11px;">Ver en admin →</a>
      </td>
    </tr>
  `).join('')
  const body = bodyParagraph(
    `Se detectaron ${args.patterns.length} patrón${args.patterns.length === 1 ? '' : 'es'} de actividad sospechosa en reseñas.`,
  ) + `<tr><td style="padding:0 0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
  </td></tr>`
  await sendEmail({
    to:      args.adminEmail,
    from:    MARKETPLACE_FROM,
    replyTo: REPLY_TO,
    subject: `[Marketplace Alert] ${args.patterns.length} patrón${args.patterns.length === 1 ? '' : 'es'} de reseñas detectado${args.patterns.length === 1 ? '' : 's'}`,
    html:    renderReviewEmail({
      headerTitle: 'Alerta · Patrones sospechosos',
      bodyHtml: body,
      disclaimer: 'Esta alerta se genera automáticamente por el cron review-patterns. Revisar manualmente en /admin antes de actuar.',
    }),
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
