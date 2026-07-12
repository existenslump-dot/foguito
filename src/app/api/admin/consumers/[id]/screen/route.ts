import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { screenSubject } from '@/lib/aml'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/admin/consumers/[id]/screen — tercera superficie AML: el CONSUMIDOR (PR-10).
 *
 * Admin-only con TOTP FRESCA + ENROLADA (misma barra que el screen de creadora y el
 * money-out). Corre el screening del fan vía el motor AML, que además deja el trail
 * append-only en `sanctions_screenings` y estampa `profiles.consumer_sanctions_status`
 * (+ `consumer_screened_at`) por service-role — el trigger `profiles_guard_aml` impide
 * que el propio fan se auto-claree, así que el flip SÓLO ocurre por acá.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ El flag consumer_sanctions_status='hit' gatea el money-in: `purchase_foguitos`│
 * │ retiene la orden en 'held_aml' (no acredita). En PROD sin vendor real el     │
 * │ stub NUNCA clarea (queda 'review') → la elegibilidad no se otorga a ciegas.  │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Flipear el flag AML de un fan = alto privilegio: 2FA ENROLADA + fresca.
  const gate = await requireAdmin(req, { requireFreshTotp: true, requireTotpEnrolled: true })
  if (!gate.ok) return gate.response

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id inválido (UUID esperado)' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // El consumidor (perfil) debe existir.
  const { data: profile, error: pErr } = (await admin
    .from('profiles')
    .select('id')
    .eq('id', id)
    .maybeSingle()) as { data: { id: string } | null; error: unknown }
  if (pErr) {
    console.error('[api/admin/consumers/screen] profile lookup error', pErr)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
  if (!profile) {
    return NextResponse.json({ error: 'consumer_not_found' }, { status: 404 })
  }

  // Screening AML. No se le pasa PII al provider (el gate del fan corta sobre 'hit'
  // por id); un throw del vendor/write ⇒ 502 (fail-closed).
  let screenStatus: 'clear' | 'review' | 'hit'
  let screenRef: string
  try {
    const screen = await screenSubject(admin, {
      subjectType: 'consumer',
      subjectId: id,
      legalName: null,
      country: null,
    })
    screenStatus = screen.status
    screenRef = screen.ref
  } catch (e) {
    console.error('[api/admin/consumers/screen] sanctions screen threw', e)
    return NextResponse.json({ error: 'sanctions_unavailable' }, { status: 502 })
  }

  void recordAudit({
    eventType: 'consumer_screened',
    actorRole: 'admin',
    actorUserId: gate.userId,
    subjectType: 'consumer',
    subjectId: id,
    req,
    metadata: {
      sanctions_status: screenStatus,
      sanctions_ref: screenRef,
    },
  })

  return NextResponse.json({ sanctions_status: screenStatus, ref: screenRef })
}
