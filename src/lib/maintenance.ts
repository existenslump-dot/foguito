/**
 * Master kill-switch for all payment flows — env-driven.
 *
 * Set `NEXT_PUBLIC_PAYMENTS_DISABLED=true` to take payments into
 * maintenance mode without a code change (the NEXT_PUBLIC_ variant is
 * required so client pages — /pagos, /planes — see the flag too; it is
 * also readable server-side). `PAYMENTS_DISABLED=true` works as a
 * server-only override for API routes.
 *
 * What `true` disables:
 *   - /pagos page renders maintenance UI instead of checkout
 *   - /planes page hides pay CTAs (pricing table stays visible)
 *   - payment-creation API endpoints return 503:
 *       /api/pagos/mp/crear-preferencia
 *       /api/pagos/mp/procesar-pago
 *       /api/pagos/crypto
 *       /api/payments/elite-nowpayments
 *
 * What stays operational:
 *   - Webhook endpoints (keep listening for in-flight payments)
 *   - Rest of the app (listings, posts, auth, dashboard, admin)
 */
export const PAYMENTS_DISABLED =
  process.env.NEXT_PUBLIC_PAYMENTS_DISABLED === 'true' ||
  process.env.PAYMENTS_DISABLED === 'true'

export const MAINTENANCE_MESSAGE = {
  title: 'Pagos en mantenimiento',
  subtitle: 'Estamos actualizando nuestra infraestructura de pagos.',
  body:
    'Por mejoras en nuestra plataforma de cobro, los pagos están temporalmente ' +
    'deshabilitados. Volveremos a estar operativos pronto. ' +
    'Si necesitas contactarnos con urgencia, puedes escribirnos.',
  cta: 'Volver a la página principal',
} as const

export function maintenanceJson() {
  return {
    error: 'payments_disabled',
    message: MAINTENANCE_MESSAGE.subtitle,
    retry_after: null,
  }
}
