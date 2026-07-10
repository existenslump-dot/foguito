import type { NowPaymentsConfig, PaymentProviderAdapter } from '../types.ts'

/**
 * STUB — shipped with the BASE kit. The real NOWPayments adapter (crypto
 * checkout, HMAC-SHA512 IPN verification, status classification) lives in the
 * **Payments add-on**. Same signature so the base compiles; construction throws
 * at runtime.
 */

const NOT_INSTALLED =
  '[payments-kit] Payments add-on not installed. The NOWPayments provider lives ' +
  'in the Payments add-on.'

export function createNowPaymentsAdapter(
  _config: NowPaymentsConfig,
  _options?: { allowUnsignedWebhooks?: boolean },
): PaymentProviderAdapter {
  throw new Error(NOT_INSTALLED)
}
