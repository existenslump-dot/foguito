import 'server-only'

/**
 * Configuración + flag de activación del proveedor de CSAM.
 *
 * Mismo molde que src/lib/didit/config.ts: el vendor real (Thorn Safer /
 * PhotoDNA / …) se selecciona con `CSAM_VENDOR` (ver src/lib/csam/index.ts), y
 * `isCsamEnabled()` lo gatea en runtime por la PRESENCIA de `CSAM_API_KEY` +
 * `CSAM_VENDOR`. Sin esas credenciales el vendor real queda dormido y el
 * built-in `stub` (determinístico, sin red — SOLO scaffolding) es el fallback.
 * Así el pipeline embarca a producción inerte y se activa recién con las creds.
 *
 * NB: el `stub` da csam_status='pass' a todo lo que no sea un sentinel de test.
 * La protección REAL del pilar #0 exige configurar un vendor de hash-matching.
 *
 * NUNCA importar desde un Client Component — `server-only` lo enforcea en build.
 */

/** ¿El vendor real de CSAM está configurado? (flag de activación en runtime) */
export function isCsamEnabled(): boolean {
  return Boolean(process.env.CSAM_API_KEY && process.env.CSAM_VENDOR)
}

/**
 * ¿Estamos en el deploy de PRODUCCIÓN? Los stubs (detector + reporter NCMEC) NO
 * pueden hablar con autoridad en prod: en prod SIN vendor real todo debe fallar
 * CERRADO (nada llega a csam_status='pass' ni a ncmec_status='reported'), para
 * no publicar sin escaneo real ni dar por hecho un reporte obligatorio que nunca
 * se envió. El stub solo puede emitir veredictos en dev/CI/preview.
 */
export function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

/** API key del vendor de CSAM. Tira si falta — llamar tras `isCsamEnabled()`. */
export function csamApiKey(): string {
  const key = process.env.CSAM_API_KEY
  if (!key) throw new Error('[csam] CSAM_API_KEY is not set')
  return key
}

/** Secreto para verificar la firma HMAC de webhooks del vendor de CSAM. */
export function csamWebhookSecret(): string {
  const secret = process.env.CSAM_WEBHOOK_SECRET
  if (!secret) throw new Error('[csam] CSAM_WEBHOOK_SECRET is not set')
  return secret
}

/** API key del reporte obligatorio a NCMEC (CyberTipline). Tira si falta. */
export function ncmecApiKey(): string {
  const key = process.env.NCMEC_REPORT_API_KEY
  if (!key) throw new Error('[csam] NCMEC_REPORT_API_KEY is not set')
  return key
}

/** Org id ante NCMEC (CyberTipline). Tira si falta. */
export function ncmecOrgId(): string {
  const id = process.env.NCMEC_REPORT_ORG_ID
  if (!id) throw new Error('[csam] NCMEC_REPORT_ORG_ID is not set')
  return id
}
