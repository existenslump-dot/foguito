import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireUser } from '@/lib/clients/require-user'
import { unlockPpv } from '@/lib/credits'
import { recordAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/content/[id]/unlock — desbloquear una pieza PPV gastando foguitos (PR-6).
 *
 * ┌── ORDEN FAIL-CLOSED (cada paso deniega, nunca otorga ante duda) ────────────┐
 * │ 1. requireUser  → sesión + same-origin (401/403). El fanId sale de la SESIÓN │
 * │ 2. id UUID válido ⇒ 400 (fail-closed ante ids basura)                        │
 * │ 3. rate-limit por fan ⇒ 429                                                  │
 * │ 4. unlock_ppv_content(p_fan=SESIÓN, p_content=id) — SÓLO service-role puede  │
 * │    ejecutarla; el precio lo pone la DB, jamás el request. Atómica + lock.    │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * El fanId es SIEMPRE de la sesión (nunca body/path). El precio NUNCA viene del
 * request — lo resuelve la RPC contra la DB. Ningún error crudo de DB sale al
 * cliente: un error de RPC ⇒ 500 opaco (fail-closed).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Tope generoso: 60 desbloqueos por minuto por fan. Corta el abuso/retry-storm
// sin molestar el uso legítimo (la RPC ya es idempotente por-pieza).
const RL_LIMIT = 60
const RL_WINDOW_MS = 60_000

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    // 1. Sesión — el fanId se liga a la sesión, NUNCA al body/path.
    const gate = await requireUser(req)
    if (!gate.ok) return gate.response
    const fanId = gate.userId

    // 2. id de contenido válido (fail-closed ante junk).
    const { id } = await ctx.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
    }

    // 3. Rate-limit por fan.
    const rl = await rateLimit(`unlock:${fanId}`, RL_LIMIT, RL_WINDOW_MS)
    if (!rl.success) {
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }

    // 4. RPC atómica (débito + entitlement). Precio de la DB, nunca del request.
    const admin = getSupabaseAdmin()
    const { data: status, error } = await unlockPpv(admin, fanId, id)
    if (error) {
      // Nunca exponer el error crudo de DB — fail-closed 500.
      console.error('[api/content/unlock] rpc error', error)
      return NextResponse.json({ error: 'error' }, { status: 500 })
    }

    switch (status) {
      case 'ok':
        void recordAudit({
          eventType: 'content_unlocked',
          actorRole: 'user',
          actorUserId: fanId,
          subjectType: 'content',
          subjectId: id,
          req,
        })
        return NextResponse.json({ status: 'unlocked' }, { status: 200 })
      case 'already_unlocked':
        // No hubo re-cobro; 200 benigno sin auditoría (no es un evento nuevo).
        return NextResponse.json({ status: 'already_unlocked' }, { status: 200 })
      case 'insufficient_funds':
        return NextResponse.json({ error: 'insufficient_funds' }, { status: 402 })
      case 'not_purchasable':
        return NextResponse.json({ error: 'not_purchasable' }, { status: 409 })
      case 'no_price':
        return NextResponse.json({ error: 'no_price' }, { status: 409 })
      case 'not_found':
        return NextResponse.json({ error: 'not_found' }, { status: 404 })
      case 'invalid':
        return NextResponse.json({ error: 'invalid' }, { status: 400 })
      default:
        // Estado desconocido ⇒ fail-closed.
        console.error('[api/content/unlock] unexpected rpc status', status)
        return NextResponse.json({ error: 'error' }, { status: 500 })
    }
  } catch (e) {
    console.error('[api/content/unlock] unexpected error', e)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
}
