import type {
  CheckoutInput,
  CheckoutSession,
  PaymentsKit,
  PaymentsKitConfig,
  ProviderName,
  ReconcileResult,
  WebhookRequest,
  WebhookResult,
} from './types.ts'

/**
 * STUB — shipped with the BASE kit. The real provider implementations
 * (MercadoPago + NOWPayments adapters, signature verification) live in the
 * **Payments add-on**. This stub keeps the public surface + types identical so
 * the base compiles and the integration type-checks, but every runtime call
 * throws. Flipping FEATURE_PAYMENTS on without the add-on does nothing.
 *
 * Install the add-on to replace this file (and the providers/signatures stubs)
 * with the real ones. See tooling/split/SPLIT.md.
 */

const NOT_INSTALLED =
  '[payments-kit] Payments add-on not installed. The base ships a stub — buy the ' +
  'Payments add-on to drop in the real MercadoPago + NOWPayments providers.'

export function createPaymentsKit(_config: PaymentsKitConfig): PaymentsKit {
  function fail(): never {
    throw new Error(NOT_INSTALLED)
  }
  return {
    providers: {},
    async createCheckout(_input: CheckoutInput): Promise<CheckoutSession> {
      return fail()
    },
    async handleWebhook(_provider: ProviderName, _req: WebhookRequest): Promise<WebhookResult> {
      return fail()
    },
    async reconcile(_provider: ProviderName, _gatewayTxId: string): Promise<ReconcileResult> {
      return fail()
    },
  }
}
