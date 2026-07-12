import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verificación de firma del IPN de NOWPayments (PR-7 money-in).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ El ÚNICO factor de confianza del webhook es esta firma HMAC. Un evento sin  │
 * │ firma válida NO acredita NADA. Verificación fail-closed, constant-time.     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Esquema NOWPayments IPN (idéntico a su ejemplo PHP oficial):
 *   1. Tomar el objeto JSON del body.
 *   2. Ordenar sus claves alfabéticamente, RECURSIVO (los objetos anidados
 *      también; los arrays conservan su orden — sólo se re-ordenan claves de
 *      objeto, igual que `ksort` recursivo + `json_encode` de PHP).
 *   3. `JSON.stringify` del objeto ordenado (sin espacios, slashes sin escapar
 *      — como `JSON_UNESCAPED_SLASHES`; JS no escapa slashes por default).
 *   4. HMAC-SHA512 de ese string con el IPN secret → hex digest.
 *   5. Comparar CONSTANT-TIME contra el header `x-nowpayments-sig`.
 *
 * Puro (sin Next/Supabase) para poder testear el HMAC en aislamiento.
 */

/**
 * Reconstruye el valor con las claves de todo objeto ordenadas alfabéticamente,
 * recursivo. Los arrays conservan su orden (sus elementos-objeto sí se ordenan).
 * Espejo del `stableStringify` de didit, pero devolviendo un valor (no un string)
 * para poder serializarlo con el `JSON.stringify` estándar.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  const obj = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeysDeep(obj[key])
  }
  return sorted
}

/**
 * String canónico que NOWPayments firma: JSON del payload con claves ordenadas
 * recursivamente. Determinístico — la misma data siempre produce el mismo string
 * (y por ende la misma firma).
 */
export function canonicalNowpaymentsBody(payload: unknown): string {
  return JSON.stringify(sortKeysDeep(payload))
}

/** HMAC-SHA512 hex del payload canónico con el secreto dado. */
export function nowpaymentsHmacHex(payload: unknown, secret: string): string {
  return createHmac('sha512', secret).update(canonicalNowpaymentsBody(payload)).digest('hex')
}

/** Comparación constant-time de dos hex digests (evita timing side-channels). */
function safeEqualHex(expectedHex: string, receivedHex: string): boolean {
  try {
    const a = Buffer.from(expectedHex, 'hex')
    const b = Buffer.from(receivedHex, 'hex')
    // `timingSafeEqual` tira si difieren en longitud → el guard de length va
    // ANTES y también es constant-time respecto al contenido.
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Verifica la firma del IPN de NOWPayments sobre el BODY CRUDO recibido.
 *
 * FAIL-CLOSED en cada borde → `false`:
 *   - secreto ausente (incl. prod sin `NOWPAYMENTS_IPN_SECRET`: un webhook sin
 *     secreto configurado NUNCA se trata como válido),
 *   - header ausente o demasiado corto,
 *   - body no parseable,
 *   - mismatch de firma.
 *
 * `rawBody` se re-parsea acá SÓLO para re-canonicalizar y firmar; el veredicto
 * cubre exactamente los bytes recibidos (el JSON del que se calcula la firma sale
 * del mismo body que verificamos).
 */
export function verifyNowpaymentsSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET
  if (!secret) return false

  // Un header ausente o demasiado corto es basura — fail-closed sin siquiera
  // computar el HMAC (un SHA512 hex son 128 chars).
  if (!signatureHeader || signatureHeader.trim().length < 16) return false

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return false
  }
  // El payload firmado debe ser un objeto JSON (no un escalar/array top-level).
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return false
  }

  const expected = nowpaymentsHmacHex(payload, secret)
  return safeEqualHex(expected, signatureHeader.trim())
}
