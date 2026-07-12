import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { creditFoguitos } from '@/lib/credits'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/credits — top-up admin/stub de foguitos (PR-6).
 *
 * El money-in real (dinero → foguitos) es PR-7. Hasta entonces, este endpoint
 * admin-gated es la única forma de que un fan tenga saldo testeable. Acredita
 * vía la RPC `credit_foguitos` (SECURITY DEFINER, doble-entrada, idempotente).
 *
 * Body: { userId, amount, reason?, idempotencyKey? }. El monto lo fija el admin
 * (no un fan) — es el único endpoint donde el monto viene del request, y está
 * detrás de requireAdmin. Error de RPC ⇒ 500 opaco (fail-closed).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  try {
    // 1. Gate admin (same-origin + is_admin). Nada se acredita sin esto.
    const gate = await requireAdmin(req)
    if (!gate.ok) return gate.response

    // 2. Body + validación.
    const body = (await req.json().catch(() => null)) as
      | { userId?: unknown; amount?: unknown; reason?: unknown; idempotencyKey?: unknown }
      | null

    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    if (!UUID_RE.test(userId)) {
      return NextResponse.json({ error: 'invalid_user' }, { status: 400 })
    }

    const amount = typeof body?.amount === 'number' ? body.amount : Number(body?.amount)
    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: 'invalid_amount' }, { status: 400 })
    }

    const reason =
      typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'admin_topup'
    // La idempotency-key del admin se NAMESPACEA (`topup:`) para que NUNCA pueda
    // colisionar con las claves internas reservadas del ledger (`ppv:<content>:<fan>`
    // del unlock). Sin esto, un admin podría quemar la idempotencia de un unlock
    // futuro → DoS permanente del desbloqueo de esa pieza para ese fan.
    const rawIdemKey =
      typeof body?.idempotencyKey === 'string' && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : null
    const idempotencyKey = rawIdemKey ? `topup:${rawIdemKey}` : null

    // 3. RPC de acreditación (doble-entrada, idempotente por idempotencyKey).
    const admin = getSupabaseAdmin()
    const { data: status, error } = await creditFoguitos(admin, userId, amount, reason, idempotencyKey)
    if (error) {
      console.error('[api/admin/credits] rpc error', error)
      return NextResponse.json({ error: 'error' }, { status: 500 })
    }

    switch (status) {
      case 'ok':
      case 'already_applied':
        void recordAudit({
          eventType: 'foguitos_credited',
          actorRole: 'admin',
          actorUserId: gate.userId,
          subjectType: 'user',
          subjectId: userId,
          req,
          metadata: { amount, reason, status, idempotent: status === 'already_applied' },
        })
        return NextResponse.json({ status }, { status: 200 })
      case 'invalid':
        return NextResponse.json({ error: 'invalid' }, { status: 400 })
      default:
        console.error('[api/admin/credits] unexpected rpc status', status)
        return NextResponse.json({ error: 'error' }, { status: 500 })
    }
  } catch (e) {
    console.error('[api/admin/credits] unexpected error', e)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
}
