import type { AgeVerifyProvider } from './provider'
import { StubAgeVerifyProvider } from './providers/stub'
import { DiditAgeVerifyProvider } from './providers/didit'

// ─────────────────────────────────────────────────────────────────────────────
// Age-verification provider factory. Same mould as src/lib/csam/index.ts.
// ─────────────────────────────────────────────────────────────────────────────

export * from './provider'
export { StubAgeVerifyProvider } from './providers/stub'
export { DiditAgeVerifyProvider } from './providers/didit'

/** Providers the factory constructs without extra wiring. */
const BUILT_IN_PROVIDERS = ['stub', 'didit'] as const

/**
 * Resolve the provider from `NEXT_PUBLIC_AGE_VERIFY_PROVIDER`. Default: `'stub'`
 * (deterministic, no network — SOLO scaffolding, fails closed in prod). The real
 * vendor is selected with `NEXT_PUBLIC_AGE_VERIFY_PROVIDER=didit` and activated
 * by `isAgeVerifyEnabled()` (AGE_VERIFY_API_KEY).
 *
 * Add a vendor: implement `AgeVerifyProvider` in
 * src/lib/age-gate/providers/<name>.ts and add a case below.
 */
export function getAgeVerifyProvider(): AgeVerifyProvider {
  const id = (process.env.NEXT_PUBLIC_AGE_VERIFY_PROVIDER ?? 'stub').trim() || 'stub'

  switch (id) {
    case 'stub':
      return new StubAgeVerifyProvider()
    case 'didit':
      return new DiditAgeVerifyProvider()
    default:
      throw new Error(
        `[age-gate] Unknown NEXT_PUBLIC_AGE_VERIFY_PROVIDER="${id}". Built-in: ${BUILT_IN_PROVIDERS.join(', ')}. ` +
          `To add another, implement the AgeVerifyProvider interface in ` +
          `src/lib/age-gate/providers/<name>.ts and register it in src/lib/age-gate/index.ts.`,
      )
  }
}
