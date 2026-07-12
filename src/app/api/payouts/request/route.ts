import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireUser } from '@/lib/clients/require-user'
import { requestPayout } from '@/lib/payouts'
import { isPayoutEnabled } from '@/lib/payouts/config'
import { recordAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/payouts/request — la creadora pide un payout de sus earnings (PR-8).
 *
 * ┌── ORDEN FAIL-CLOSED ────────────────────────────────────────────────────────┐
 * │ 0. isPayoutEnabled() else 404 (riel inerte sin el flag)                      │
 * │ 1. requireUser → sesión + same-origin (401/403). creatorId de la SESIÓN      │
 * │ 2. rate-limit por creadora ⇒ 429                                             │
 * │ 3. body { amountFoguitos } entero positivo ⇒ 400                             │
 * │ 4. request_payout(p_creator=SESIÓN, p_amount_foguitos) — SÓLO service-role;  │
 * │    la elegibilidad (payout-KYC + sanciones), el overdraft-guard y la reserva │
 * │    los hace la RPC. El creatorId es SIEMPRE de la sesión, nunca del body.    │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * Mapeo de estados de la RPC → HTTP:
 *   ok → 200 + audit `payout_requested` · not_eligible → 403 (falta payout-KYC/
 *   sanciones) · insufficient_earnings → 402 · already_pending → 409 ·
 *   amount_too_small|invalid → 400 · error de RPC → 500 (opaco, fail-closed).
 */

const RL_LIMIT = 10
const RL_WINDOW_MS = 60_000

export async function POST(req: NextRequest) {
  try {
    // 0. Feature flag — sin él el riel de payout está inerte.
    if (!isPayoutEnabled()) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    // 1. Sesión — creatorId ligado a la sesión, NUNCA al body.
    const gate = await requireUser(req)
    if (!gate.ok) return gate.response
    const creatorId = gate.userId

    // 2. Rate-limit por creadora.
    const rl = await rateLimit(`payout-request:${creatorId}`, RL_LIMIT, RL_WINDOW_MS)
    if (!rl.success) {
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }

    // 3. Body + validación (entero positivo). El monto es una intención; la RPC
    //    re-chequea earnings/elegibilidad autoritativamente.
    const body = (await req.json().catch(() => null)) as { amountFoguitos?: unknown } | null
    const amountFoguitos =
      typeof body?.amountFoguitos === 'number' ? body.amountFoguitos : Number(body?.amountFoguitos)
    if (!Number.isInteger(amountFoguitos) || amountFoguitos <= 0) {
      return NextResponse.json({ error: 'invalid_amount' }, { status: 400 })
    }

    // 4. RPC atómica (reserva + gate). Precio/reserva de la DB.
    const admin = getSupabaseAdmin()
    const { data: status, error } = await requestPayout(admin, creatorId, amountFoguitos)
    if (error) {
      console.error('[api/payouts/request] rpc error', error)
      return NextResponse.json({ error: 'error' }, { status: 500 })
    }

    switch (status) {
      case 'ok':
        void recordAudit({
          eventType: 'payout_requested',
          actorRole: 'user',
          actorUserId: creatorId,
          subjectType: 'creator',
          subjectId: creatorId,
          req,
          metadata: { amount_foguitos: amountFoguitos },
        })
        return NextResponse.json({ status: 'requested' }, { status: 200 })
      case 'not_eligible':
        return NextResponse.json({ error: 'not_eligible' }, { status: 403 })
      case 'insufficient_earnings':
        return NextResponse.json({ error: 'insufficient_earnings' }, { status: 402 })
      case 'already_pending':
        return NextResponse.json({ error: 'already_pending' }, { status: 409 })
      case 'amount_too_small':
        return NextResponse.json({ error: 'amount_too_small' }, { status: 400 })
      case 'invalid':
        return NextResponse.json({ error: 'invalid' }, { status: 400 })
      default:
        console.error('[api/payouts/request] unexpected rpc status', status)
        return NextResponse.json({ error: 'error' }, { status: 500 })
    }
  } catch (e) {
    console.error('[api/payouts/request] unexpected error', e)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
}
