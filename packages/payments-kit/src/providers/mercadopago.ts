import type { MercadoPagoConfig, PaymentProviderAdapter } from '../types.ts'

/**
 * STUB — shipped with the BASE kit. The real MercadoPago adapter (Checkout Pro
 * redirect, Bricks card_token, PIX, signature-verified webhooks with
 * gateway-truth re-fetch) lives in the **Payments add-on**. Same signature so
 * the base compiles; construction throws at runtime.
 */

const NOT_INSTALLED =
  '[payments-kit] Payments add-on not installed. The MercadoPago provider lives ' +
  'in the Payments add-on.'

export function createMercadoPagoAdapter(
  _config: MercadoPagoConfig,
  _options?: { allowUnsignedWebhooks?: boolean },
): PaymentProviderAdapter {
  throw new Error(NOT_INSTALLED)
}
