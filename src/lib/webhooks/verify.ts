/**
 * Webhook signature verification.
 *
 * The canonical implementations live in the payments kit
 * (packages/payments-kit/src/signatures.ts) — this module re-exports them so
 * existing app imports (and test seams) keep working without duplicating the
 * crypto.
 */
export {
  verifyMercadoPagoSignature,
  verifyNowPaymentsSignature,
} from '@marketplace/payments-kit'
