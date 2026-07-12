import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { getSanctionsProvider } from '@/lib/payouts/provider'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Valores válidos de `creators.payout_kyc_status` (el admin lo puede setear). */
const PAYOUT_KYC_VALUES = new Set(['none', 'pending', 'verified', 'rejected'])

type CreatorRow = {
  user_id: string
  pseudonym: string | null
  country: string | null
} | null

/**
 * POST /api/admin/creators/[id]/screen — onboarding de payout-KYC + sanciones (PR-8).
 *
 * Admin-only con TOTP FRESCA. Corre el screening de sanciones para la creadora y,
 * según el veredicto, setea `creators.sanctions_status` (clear/review/hit) vía
 * service-role (así el trigger `creators_guard_privileged` deja pasar la escritura
 * — un `authenticated` común la revertiría). Opcionalmente setea
 * `payout_kyc_status` (el admin marca payout-KYC 'verified' tras la KYC off-platform).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ Este es el path (respaldado por stub) que FLIPEA las columnas de            │
 * │ elegibilidad. En PROD sin vendor real, `screen()` devuelve 'review' (NUNCA  │
 * │ auto-clarea) → la elegibilidad NO se puede otorgar con el stub en prod.     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Body: { payoutKyc? } donde payoutKyc ∈ none|pending|verified|rejected (opcional).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Flipear elegibilidad de payout = alto privilegio: 2FA ENROLADA + fresca.
  const gate = await requireAdmin(req, { requireFreshTotp: true, requireTotpEnrolled: true })
  if (!gate.ok) return gate.response

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id inválido (UUID esperado)' }, { status: 400 })
  }

  const body = (await req.json().catch(() => null)) as { payoutKyc?: unknown } | null
  let payoutKyc: string | null = null
  if (body?.payoutKyc !== undefined && body?.payoutKyc !== null) {
    const v = typeof body.payoutKyc === 'string' ? body.payoutKyc.trim() : ''
    if (!PAYOUT_KYC_VALUES.has(v)) {
      return NextResponse.json({ error: 'invalid_payout_kyc' }, { status: 400 })
    }
    payoutKyc = v
  }

  const admin = getSupabaseAdmin()

  // La creadora debe existir (necesito sus datos para el screening).
  const { data: creator, error: cErr } = (await admin
    .from('creators')
    .select('user_id, pseudonym, country')
    .eq('user_id', id)
    .maybeSingle()) as { data: CreatorRow; error: unknown }
  if (cErr) {
    console.error('[api/admin/creators/screen] creator lookup error', cErr)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
  if (!creator) {
    return NextResponse.json({ error: 'creator_not_found' }, { status: 404 })
  }

  // Screening de sanciones. Un throw del vendor real ⇒ 502 (no se toca la columna).
  let screenStatus: 'clear' | 'review' | 'hit'
  let screenRef: string
  try {
    const screen = await getSanctionsProvider().screen({
      creatorId: id,
      legalName: creator.pseudonym ?? null,
      country: creator.country ?? null,
    })
    screenStatus = screen.status
    screenRef = screen.ref
  } catch (e) {
    console.error('[api/admin/creators/screen] sanctions screen threw', e)
    return NextResponse.json({ error: 'sanctions_unavailable' }, { status: 502 })
  }

  // Escribir el veredicto (service-role pasa el guard privilegiado). El screen.status
  // mapea 1:1 a sanctions_status.
  const patch: Record<string, unknown> = { sanctions_status: screenStatus }
  if (payoutKyc) patch.payout_kyc_status = payoutKyc

  const { error: upErr } = await admin.from('creators').update(patch).eq('user_id', id)
  if (upErr) {
    console.error('[api/admin/creators/screen] update error', upErr)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }

  void recordAudit({
    eventType: 'creator_screened',
    actorRole: 'admin',
    actorUserId: gate.userId,
    subjectType: 'creator',
    subjectId: id,
    req,
    metadata: {
      sanctions_status: screenStatus,
      sanctions_ref: screenRef,
      payout_kyc_status: payoutKyc ?? undefined,
    },
  })

  return NextResponse.json({
    sanctions_status: screenStatus,
    payout_kyc_status: payoutKyc ?? undefined,
    ref: screenRef,
  })
}
