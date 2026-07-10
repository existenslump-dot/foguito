import type { SupabaseClient } from '@supabase/supabase-js'
import { MARKETPLACE } from '@/config/marketplace.config'
import type { KycProvider } from './provider'
import { ManualKycProvider } from './providers/manual'

// ─────────────────────────────────────────────────────────────────────────────
// KYC provider factory + feature helper.
// ─────────────────────────────────────────────────────────────────────────────

export * from './provider'
export { ManualKycProvider } from './providers/manual'

/** Built-in provider ids the factory can construct without extra wiring. */
const BUILT_IN_PROVIDERS = ['manual'] as const

/**
 * Whether the verification module is active for this deployment.
 * Mirrors `MARKETPLACE.features.kyc` (FEATURE_KYC env). The single source of
 * truth so every gate (pages, APIs, components) agrees.
 */
export function kycEnabled(): boolean {
  return MARKETPLACE.features.kyc
}

/**
 * Resolve the configured KYC provider from the `KYC_PROVIDER` env var.
 * Defaults to `'manual'` (the built-in homegrown flow).
 *
 * @param supabase Optional Supabase client forwarded to providers that read
 *   status from the DB (the manual provider). Server callers should pass the
 *   service-role admin client.
 *
 * Adding a provider (e.g. Didit): implement the `KycProvider` interface in
 * src/lib/kyc/providers/<name>.ts and add a case below. See
 * src/lib/kyc/provider.ts.
 */
export function getKycProvider(supabase?: SupabaseClient): KycProvider {
  const id = (process.env.KYC_PROVIDER ?? 'manual').trim() || 'manual'

  switch (id) {
    case 'manual':
      return new ManualKycProvider(supabase)
    default:
      throw new Error(
        `[kyc] Unknown KYC_PROVIDER="${id}". Built-in providers: ${BUILT_IN_PROVIDERS.join(', ')}. ` +
          `To add another (e.g. Didit), implement the KycProvider interface in ` +
          `src/lib/kyc/provider.ts and register it in src/lib/kyc/index.ts.`,
      )
  }
}
