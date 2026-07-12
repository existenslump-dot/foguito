import 'server-only'

/**
 * Configuración + flags de activación del riel de money-in (dinero → foguitos).
 *
 * Mismo molde que src/lib/csam/config.ts y src/lib/didit/config.ts: el procesador
 * real (merchant-of-record, PAN cero) se activa por la PRESENCIA de credenciales.
 * Sin `NOWPAYMENTS_API_KEY` el provider real queda dormido y el `stub`
 * (determinístico, sin red — SOLO scaffolding) es el fallback en dev/CI. Así el
 * riel embarca a producción INERTE y se activa recién cuando el founder cablea
 * un procesador — hasta entonces NINGÚN dinero real puede moverse.
 *
 * Dos flags DISTINTOS a propósito:
 *   - `isFoguitoPaymentsEnabled()` → feature flag del money-in (UI + checkout).
 *     Off por default; inerte sin él. Distinto del `FEATURE_PAYMENTS` del engine
 *     (ese gatea el riel MercadoPago heredado, que Foguito NO usa).
 *   - `isNowpaymentsConfigured()` → ¿hay credenciales del procesador? Gatea el
 *     path real del provider (fail-closed en prod sin creds).
 *
 * NUNCA importar desde un Client Component — `server-only` lo enforcea en build.
 */

/**
 * ¿El money-in (compra de foguitos con dinero real) está habilitado?
 * Off por default: sin este flag la UI `/comprar` y el endpoint de checkout
 * quedan inertes. El webhook NO depende de este flag — siempre verifica la firma
 * (fail-closed) para no perder una confirmación de un pago ya en vuelo.
 */
export function isFoguitoPaymentsEnabled(): boolean {
  return process.env.FOGUITOS_PAYMENTS_ENABLED === 'true'
}

/** ¿El procesador NOWPayments está configurado? (activa el path real del provider) */
export function isNowpaymentsConfigured(): boolean {
  return Boolean(process.env.NOWPAYMENTS_API_KEY)
}

/**
 * ¿Estamos en el deploy de PRODUCCIÓN? El stub NO puede cobrar/acreditar en prod:
 * en prod SIN procesador real todo el path de pago debe fallar CERRADO. El stub
 * sólo emite direcciones de pago fake en dev/CI/preview.
 *
 * Se chequea `VERCEL_ENV==='production'` (deploy prod en Vercel) O
 * `NODE_ENV==='production'` (cualquier host prod no-Vercel) → la invariante
 * "el stub jamás corre en prod" se sostiene fuera de Vercel también. En `next
 * build` NODE_ENV es 'production' pero este getter sólo se evalúa en runtime
 * (dentro de createCheckout), así que no hay falso-positivo de build.
 */
export function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
}

/** API key de NOWPayments. Tira si falta — llamar tras `isNowpaymentsConfigured()`. */
export function nowpaymentsApiKey(): string {
  const key = process.env.NOWPAYMENTS_API_KEY
  if (!key) throw new Error('[foguitos] NOWPAYMENTS_API_KEY is not set')
  return key
}

/**
 * Secreto para verificar la firma HMAC del IPN de NOWPayments. Tira si falta.
 * OJO: la verificación de firma (`verifyNowpaymentsSignature`) NO usa este getter
 * — lee el env directo y fail-closes a `false` si falta, para nunca tirar ante un
 * webhook sin secreto configurado (un throw sería un 500 y un reintento infinito).
 */
export function nowpaymentsIpnSecret(): string {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET
  if (!secret) throw new Error('[foguitos] NOWPAYMENTS_IPN_SECRET is not set')
  return secret
}
