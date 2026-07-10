import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PAYMENTS_DISABLED } from '@/lib/maintenance'
import { PAYMENTS_ENABLED } from '@/config/marketplace.config'

// Static metadata for the payments entry point. /pagos is a client component,
// so the SEO fields live here (served in the initial HTML) instead of being
// inherited blank from the root layout.
export const metadata: Metadata = {
  // Bare segment — the root layout's title template (`%s | Marketplace`) already
  // appends the suffix; including it here produced `Pagos · Marketplace | Marketplace`.
  title: 'Pagos',
  description:
    'Seleccioná tu plan y método de pago (MercadoPago, tarjetas, transferencia, criptomonedas). Tras recibir el pago, nuestro equipo activa tu suscripción manualmente en menos de 24 h.',
  alternates: { canonical: '/pagos' },
  robots: PAYMENTS_DISABLED
    ? { index: false, follow: true }
    : { index: true, follow: true },
}

export default function PagosLayout({ children }: { children: React.ReactNode }) {
  // Payments is a paid add-on, off by default. When disabled the checkout page
  // must be unreachable — bounce to the gateway.
  if (!PAYMENTS_ENABLED) redirect('/')
  return <>{children}</>
}
