import { MercadoPagoConfig } from 'mercadopago'

/**
 * Mercado Pago config singleton.
 *
 * The `MercadoPagoConfig` constructor is lightweight but invoking it per
 * webhook request still adds up across the hot webhook path (dozens of
 * IPNs per minute once we're live). Cache once per worker; re-throw
 * early if MP_ACCESS_TOKEN is missing so we fail fast instead of at
 * the first API call.
 */

let cached: MercadoPagoConfig | null = null

export function getMpConfig(): MercadoPagoConfig {
  if (cached) return cached
  const accessToken = process.env.MP_ACCESS_TOKEN
  if (!accessToken) {
    throw new Error('[mercadopago] MP_ACCESS_TOKEN is not set')
  }
  cached = new MercadoPagoConfig({ accessToken })
  return cached
}
