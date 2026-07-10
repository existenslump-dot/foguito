/**
 * Canonical NOWPayments IPN endpoint (tier payments + Elite subscriptions).
 * All logic lives in the unified handler — see lib/payments/nowpayments-webhook.
 */
export { handleNowPaymentsIpn as POST } from '@/lib/payments/nowpayments-webhook'

export const runtime = 'nodejs'
