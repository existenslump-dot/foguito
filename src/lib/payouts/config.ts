import 'server-only'

/**
 * Configuración + flags de activación del riel de MONEY-OUT (payout regulado a
 * creadoras: VASP/PSP + Travel Rule + sanciones + payout-KYC) — PR-8.
 *
 * Mismo molde que src/lib/foguitos/config.ts (money-in) y src/lib/csam/config.ts:
 * el rail embarca a producción INERTE y se activa recién cuando el founder cablea
 * un VASP/PSP real. Hasta entonces NINGÚN dinero real puede salir.
 *
 * Flags DISTINTOS a propósito:
 *   - `isPayoutEnabled()` → feature flag del money-out (UI /dashboard/payouts +
 *     endpoint de request). Off por default; inerte sin él. El webhook del VASP
 *     NO depende de este flag — siempre verifica la firma (fail-closed).
 *   - `isPayoutConfigured()` → ¿hay credenciales del VASP/PSP? Gatea el path real
 *     del provider de transferencia (fail-closed en prod sin creds).
 *   - `isSanctionsConfigured()` → ¿hay vendor de screening de sanciones?
 *   - `isTravelRuleConfigured()` → ¿hay proveedor de Travel Rule (IVMS101/TRP)?
 *
 * NUNCA importar desde un Client Component — `server-only` lo enforcea en build.
 */

/**
 * ¿El money-out (payout a creadoras) está habilitado? Off por default: sin este
 * flag la UI /dashboard/payouts y el endpoint /api/payouts/request quedan inertes
 * (404). El webhook de settlement del VASP NO depende de este flag — siempre
 * verifica la firma para no perder una confirmación de una transferencia en vuelo.
 */
export function isPayoutEnabled(): boolean {
  return process.env.PAYOUT_ENABLED === 'true'
}

/** ¿El VASP/PSP de payout está configurado? (activa el path real del provider) */
export function isPayoutConfigured(): boolean {
  return Boolean(process.env.PAYOUT_API_KEY)
}

/** ¿El vendor de screening de sanciones está configurado? (activa el screen real) */
export function isSanctionsConfigured(): boolean {
  return Boolean(process.env.SANCTIONS_API_KEY)
}

/** ¿El proveedor de Travel Rule está configurado? (activa el submit real) */
export function isTravelRuleConfigured(): boolean {
  return Boolean(process.env.TRAVEL_RULE_API_KEY)
}

/**
 * ¿Estamos en el deploy de PRODUCCIÓN? Los stubs (VASP + sanciones + Travel Rule)
 * NO pueden mover plata ni dar por limpia a una creadora en prod: en prod SIN
 * vendors reales todo el path de payout debe fallar CERRADO. El stub de sanciones
 * jamás auto-clarea en prod; el stub de VASP jamás transfiere en prod.
 *
 * Se chequea `VERCEL_ENV==='production'` (deploy prod en Vercel) O
 * `NODE_ENV==='production'` (cualquier host prod no-Vercel) → la invariante "los
 * stubs jamás corren en prod" se sostiene fuera de Vercel también. En `next build`
 * NODE_ENV es 'production' pero estos getters sólo se evalúan en runtime (dentro
 * de screen/sendPayout/submit), así que no hay falso-positivo de build.
 */
export function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
}

/** API key del VASP/PSP de payout. Tira si falta — llamar tras `isPayoutConfigured()`. */
export function payoutApiKey(): string {
  const key = process.env.PAYOUT_API_KEY
  if (!key) throw new Error('[payouts] PAYOUT_API_KEY is not set')
  return key
}

/** API key del vendor de sanciones. Tira si falta — llamar tras `isSanctionsConfigured()`. */
export function sanctionsApiKey(): string {
  const key = process.env.SANCTIONS_API_KEY
  if (!key) throw new Error('[payouts] SANCTIONS_API_KEY is not set')
  return key
}

/** API key del proveedor de Travel Rule. Tira si falta — llamar tras `isTravelRuleConfigured()`. */
export function travelRuleApiKey(): string {
  const key = process.env.TRAVEL_RULE_API_KEY
  if (!key) throw new Error('[payouts] TRAVEL_RULE_API_KEY is not set')
  return key
}

/**
 * Secreto para verificar la firma HMAC del webhook de settlement del VASP. Tira si
 * falta. OJO: la verificación (`verifyPayoutWebhookSignature`) NO usa este getter —
 * lee el env directo y fail-closes a `false` si falta, para nunca tirar ante un
 * webhook sin secreto configurado (un throw sería un 500 y un reintento infinito).
 */
export function payoutWebhookSecret(): string {
  const secret = process.env.PAYOUT_WEBHOOK_SECRET
  if (!secret) throw new Error('[payouts] PAYOUT_WEBHOOK_SECRET is not set')
  return secret
}

/**
 * ⚠️ PLACEHOLDER de DISPLAY — foguitos por 1 USD, sólo para estimados de UI.
 * La tasa AUTORITATIVA es la función DB `foguitos_per_usd()` (server-authoritative,
 * la que usan `request_payout`/`advance_payout` para el monto real del payout).
 * Este mirror es únicamente para mostrar un "≈ US$X" en /dashboard/payouts; NUNCA
 * se usa para calcular el débito/reserva (eso lo hace la DB). Si el founder cambia
 * el rate real en la DB, actualizar también este número (o la estimación mentirá).
 */
export const FOGUITOS_PER_USD_DISPLAY = 100
