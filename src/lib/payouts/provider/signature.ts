import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verificación de firma del webhook de settlement del VASP (PR-8 money-out).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ El ÚNICO factor de confianza del webhook es esta firma HMAC. Un evento sin  │
 * │ firma válida NO avanza NADA. Verificación fail-closed, constant-time, sobre │
 * │ los BYTES CRUDOS del body.                                                   │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Esquema (⚠️ PROVIDER-SPECIFIC — a finalizar al cablear el VASP real):
 *   HMAC-SHA256 del body crudo (bytes exactos) con `PAYOUT_WEBHOOK_SECRET` → hex.
 *   El header puede venir como `sha256=<hex>` o hex pelado; se tolera el prefijo.
 *   Se compara CONSTANT-TIME contra el header `x-payout-signature`.
 *
 * Se firma sobre los bytes crudos (no re-canonicaliza el JSON): el veredicto cubre
 * exactamente lo recibido. Distinto del IPN de NOWPayments (que re-ordena claves)
 * a propósito — la mayoría de los VASP firman el raw body. Cuando se cablee el VASP
 * concreto, ajustar el header/scheme acá (única fuente).
 *
 * Puro (sin Next/Supabase) para poder testear el HMAC en aislamiento.
 */

/** HMAC-SHA256 hex del body crudo con el secreto dado. */
export function payoutWebhookHmacHex(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

/** Comparación constant-time de dos hex digests (evita timing side-channels). */
function safeEqualHex(expectedHex: string, receivedHex: string): boolean {
  try {
    const a = Buffer.from(expectedHex, 'hex')
    const b = Buffer.from(receivedHex, 'hex')
    // `timingSafeEqual` tira si difieren en longitud → el guard de length va ANTES
    // y también es constant-time respecto al contenido.
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Verifica la firma del webhook del VASP sobre el BODY CRUDO recibido.
 *
 * FAIL-CLOSED en cada borde → `false`:
 *   - secreto ausente (incl. prod sin `PAYOUT_WEBHOOK_SECRET`: un webhook sin
 *     secreto configurado NUNCA se trata como válido),
 *   - header ausente o demasiado corto,
 *   - mismatch de firma.
 */
export function verifyPayoutWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.PAYOUT_WEBHOOK_SECRET
  if (!secret) return false

  if (!signatureHeader) return false
  // Tolera el prefijo `sha256=` (esquema común); normaliza a hex pelado.
  const received = signatureHeader.trim().replace(/^sha256=/i, '')
  // Un header demasiado corto es basura — fail-closed sin computar el HMAC (un
  // SHA256 hex son 64 chars).
  if (received.length < 16) return false

  const expected = payoutWebhookHmacHex(rawBody, secret)
  return safeEqualHex(expected, received)
}
