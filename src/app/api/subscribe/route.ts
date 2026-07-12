import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireUser } from '@/lib/clients/require-user'
import { subscribeCreator } from '@/lib/credits'
import { recordAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/subscribe — suscribirse a una creadora gastando foguitos (PR-6).
 *
 * ┌── ORDEN FAIL-CLOSED ────────────────────────────────────────────────────────┐
 * │ 1. requireUser  → sesión + same-origin (401/403). fanId de la SESIÓN         │
 * │ 2. creatorId UUID válido ⇒ 400; auto-suscripción (creatorId === fanId) ⇒ 400 │
 * │ 3. rate-limit por fan ⇒ 429                                                  │
 * │ 4. subscribe_creator(p_fan=SESIÓN, p_creator=body) — SÓLO service-role; el   │
 * │    precio/period lo pone la DB. Atómica + lock por-fan.                       │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * Body: { creatorId }. El fanId es SIEMPRE de la sesión (nunca del body). El
 * precio NUNCA viene del request. Error de RPC ⇒ 500 opaco (fail-closed).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const RL_LIMIT = 30
const RL_WINDOW_MS = 60_000

export async function POST(req: NextRequest) {
  try {
    // 1. Sesión — fanId ligado a la sesión, NUNCA al body.
    const gate = await requireUser(req)
    if (!gate.ok) return gate.response
    const fanId = gate.userId

    // 2. Body + validación.
    const body = (await req.json().catch(() => null)) as { creatorId?: unknown } | null
    const creatorId = typeof body?.creatorId === 'string' ? body.creatorId.trim() : ''
    if (!UUID_RE.test(creatorId)) {
      return NextResponse.json({ error: 'invalid_creator' }, { status: 400 })
    }
    // No se puede suscribir a sí misma (la RPC igual lo rechaza; corta antes).
    if (creatorId === fanId) {
      return NextResponse.json({ error: 'cannot_subscribe_self' }, { status: 400 })
    }

    // 3. Rate-limit por fan.
    const rl = await rateLimit(`subscribe:${fanId}`, RL_LIMIT, RL_WINDOW_MS)
    if (!rl.success) {
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }

    // 4. RPC atómica (débito + upsert de suscripción). Precio de la DB.
    const admin = getSupabaseAdmin()
    const { data: status, error } = await subscribeCreator(admin, fanId, creatorId)
    if (error) {
      console.error('[api/subscribe] rpc error', error)
      return NextResponse.json({ error: 'error' }, { status: 500 })
    }

    switch (status) {
      case 'ok':
        void recordAudit({
          eventType: 'subscription_created',
          actorRole: 'user',
          actorUserId: fanId,
          subjectType: 'creator',
          subjectId: creatorId,
          req,
        })
        return NextResponse.json({ status: 'subscribed' }, { status: 200 })
      case 'already_active':
        return NextResponse.json({ status: 'already_active' }, { status: 200 })
      case 'insufficient_funds':
        return NextResponse.json({ error: 'insufficient_funds' }, { status: 402 })
      case 'subs_not_offered':
        return NextResponse.json({ error: 'subs_not_offered' }, { status: 409 })
      case 'invalid':
        return NextResponse.json({ error: 'invalid' }, { status: 400 })
      default:
        console.error('[api/subscribe] unexpected rpc status', status)
        return NextResponse.json({ error: 'error' }, { status: 500 })
    }
  } catch (e) {
    console.error('[api/subscribe] unexpected error', e)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
}
