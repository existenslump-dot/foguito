import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { advancePayout, type PayoutTargetStatus } from '@/lib/payouts'
import { recordAudit } from '@/lib/audit'
import { verifyPayoutWebhookSignature } from '@/lib/payouts/provider/signature'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/payouts — callback de settlement del VASP (PR-8 money-out).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ El ÚNICO factor de confianza es la firma HMAC. NO hay sesión, NO hay        │
 * │ same-origin (un webhook no manda cookies ni Origin). Un evento sin firma    │
 * │ válida NO avanza NADA (401). El estado del payout lo mueve la RPC           │
 * │ `advance_payout` (atómica, idempotente, terminal-freeze).                   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Orden (espejo del IPN de money-in):
 *   1. Leer el body CRUDO (bytes exactos para el HMAC). Parsear SÓLO tras verificar.
 *   2. Verificar la firma ⇒ false → 401.
 *   3. Parsear JSON.
 *   4. Buscar el payout por su referencia (`payout_ref` = `payouts.id`). Desconocido
 *      → 200 + alerta (nunca 500-loop).
 *   5. Mapear el estado del VASP → 'sent' | 'failed' | (no-final → ack sin avanzar).
 *   6. advance_payout (idempotente; terminal-freeze). error de RPC → 500 (reintento).
 *   7. Ack 200 para todo evento verificado ya manejado.
 *
 * ⚠️ El webhook NUNCA puede forzar 'sent' saltándose el gate: la RPC re-exige
 * travel_rule_ref + payout-KYC + sanciones 'clear' (y el `payouts_guard` es el
 * back-stop de DB). Un 'sent' que no cumple → 'missing_travel_rule'/'not_eligible',
 * ackeado sin avanzar. Sólo 'failed' no tiene precondiciones (revierte la reserva).
 */

// Estados del VASP que se mapean a un avance terminal (⚠️ PROVIDER-SPECIFIC — a
// finalizar al cablear el VASP real).
const SETTLED_STATUSES = new Set(['settled', 'completed', 'sent', 'success', 'confirmed'])
const FAILED_STATUSES = new Set(['failed', 'rejected', 'error', 'cancelled', 'canceled', 'returned'])

type PayoutRow = {
  id: string
  status: string
  creator_id: string
} | null

export async function POST(req: Request) {
  try {
    // 1. Body CRUDO — los bytes exactos que cubre la firma. Parsear DESPUÉS.
    const rawBody = await req.text()

    // 2. Firma: el único factor de confianza. Fail-closed → 401, no se avanza nada.
    if (!verifyPayoutWebhookSignature(rawBody, req.headers.get('x-payout-signature'))) {
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
    }

    // 3. Recién ahora (firma OK) parseamos.
    let event: Record<string, unknown>
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return NextResponse.json({ ok: true, warn: 'unparseable body' })
    }

    // Referencia del payout = nuestro `payouts.id` (el VASP lo ecoa). Aceptamos
    // varios nombres comunes por robustez.
    const payoutRef =
      pickString(event.payout_ref) ||
      pickString(event.payout_id) ||
      pickString(event.order_id) ||
      pickString(event.reference)
    const vaspStatus = (pickString(event.status) || pickString(event.payout_status)).toLowerCase()
    const vaspTxId =
      pickString(event.vasp_tx_id) || pickString(event.tx_id) || pickString(event.transaction_id) || null

    if (!payoutRef) {
      return NextResponse.json({ ok: true, warn: 'missing payout_ref' })
    }

    const admin = getSupabaseAdmin()

    // 4. Buscar el payout. Desconocido → ack 200 + alerta (retry de otro entorno o
    //    tampering; nunca un 500-loop).
    const { data: payout } = (await admin
      .from('payouts')
      .select('id, status, creator_id')
      .eq('id', payoutRef)
      .maybeSingle()) as { data: PayoutRow }

    if (!payout) {
      console.error('[payouts/webhook] unknown payout_ref:', payoutRef)
      void recordAudit({
        eventType: 'payout_webhook_unknown',
        actorRole: 'system',
        subjectType: 'payout',
        subjectId: payoutRef,
        req,
        metadata: { vasp_status: vaspStatus },
      })
      return NextResponse.json({ ok: true, warn: 'unknown payout' })
    }

    // 5. Mapear estado del VASP → avance. No-final ⇒ ack sin avanzar.
    let newStatus: PayoutTargetStatus | null = null
    if (SETTLED_STATUSES.has(vaspStatus)) newStatus = 'sent'
    else if (FAILED_STATUSES.has(vaspStatus)) newStatus = 'failed'

    if (!newStatus) {
      // Estado intermedio/desconocido: ack sin mover la máquina (nunca se marca
      // terminal fuera de settled/failed).
      return NextResponse.json({ ok: true, status: vaspStatus || 'unknown' })
    }

    // 6. Avanzar (idempotente + terminal-freeze en la RPC). El vaspTxId se persiste.
    const { data: status, error } = await advancePayout(admin, payout.id, newStatus, {
      vaspTxId,
    })
    if (error) {
      // El avance NO ocurrió: 500 para que el VASP REINTENTE.
      console.error('[payouts/webhook] advance_payout rpc error', error)
      return NextResponse.json({ error: 'settlement_failed' }, { status: 500 })
    }

    void recordAudit({
      eventType: 'payout_settlement',
      actorRole: 'system',
      subjectType: 'payout',
      subjectId: payout.id,
      req,
      metadata: { vasp_status: vaspStatus, target_status: newStatus, rpc_status: status, vasp_tx_id: vaspTxId },
    })

    // 'ok' | 'already' | 'terminal' | 'missing_travel_rule' | 'not_eligible' | … →
    // todos se ackean (idempotencia / terminal-freeze / precondición los resuelve la
    // RPC; un retry no debe reintentar infinito).
    return NextResponse.json({ ok: true, status })
  } catch (e) {
    console.error('[payouts/webhook] unexpected error', e)
    return NextResponse.json({ error: 'error' }, { status: 500 })
  }
}

/** Devuelve el string si el valor es un string no vacío, si no ''. */
function pickString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
