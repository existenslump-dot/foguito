import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { getResend } from '@/lib/clients/resend'
import { renderEmail } from '@/lib/emails'

export const runtime = 'nodejs'

/**
 * Per-IP cooldown for the duplicate-account admin alert. Without this, a
 * single IP that keeps hitting the register endpoint after its 429 trips
 * our admin inbox once per retry — trivially spammable. We dedupe for 24h
 * in-memory, which survives warm Vercel invocations but not cold boots.
 *
 * That's fine for the threat model: the attacker is already blocked by
 * the 429 itself, so the alert's only purpose is to wake up the admin
 * *once* per unique sustained incident. A cold boot leaking a second
 * alert every hour-ish is acceptable.
 */
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000
const recentAlerts = new Map<string, number>()

function shouldSendAlert(ip: string): boolean {
  const now = Date.now()
  const last = recentAlerts.get(ip)
  if (last && now - last < ALERT_COOLDOWN_MS) return false
  recentAlerts.set(ip, now)
  // Housekeeping: drop entries older than the cooldown so the map can't
  // balloon under long-running instances with many distinct IPs.
  if (recentAlerts.size > 500) {
    for (const [key, ts] of recentAlerts) {
      if (now - ts >= ALERT_COOLDOWN_MS) recentAlerts.delete(key)
    }
  }
  return true
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdmin()
    const { phone } = await req.json()
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
              || req.headers.get('x-real-ip')
              || 'unknown'

    // Check if phone already registered
    if (phone) {
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('phone', phone)
        .limit(1)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ error: 'Este número ya está registrado.' }, { status: 409 })
      }
    }

    // Check IP-based duplicate accounts (>3 in 30 days)
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: ipAccounts } = await supabase
      .from('profiles')
      .select('id')
      .eq('registration_ip', ip)
      .gte('created_at', since30d)
    if ((ipAccounts?.length ?? 0) >= 3) {
      // Flag and alert admin — only the first time per day per IP, so
      // a retrying attacker can't flood the admin inbox.
      if (shouldSendAlert(ip)) {
        await alertAdmin(ip)
      }
      return NextResponse.json({ error: 'No se puede crear otra cuenta desde este dispositivo.' }, { status: 429 })
    }

    return NextResponse.json({ ok: true, ip })
  } catch (err) {
    console.error('Register check error:', err)
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 })
  }
}

async function alertAdmin(ip: string) {
  if (!process.env.RESEND_API_KEY) return
  const resend = getResend()
  await resend.emails.send({
    from: 'MARKETPLACE+ Seguridad <noreply@example.com>',
    replyTo: 'contacto@example.com',
    to: ['admin@example.com'],
    subject: `Alerta: posible cuenta duplicada — IP ${ip}`,
    html: renderEmail(`
      <h2 style="color:#e05555">Alerta de seguridad</h2>
      <p>Se detectaron más de 3 cuentas registradas desde la IP <strong>${ip}</strong> en los últimos 30 días.</p>
    `),
  }).catch((e: unknown) => console.error('Alert email error:', e))
}
