import type { CsamProvider } from './provider'
import { StubCsamProvider } from './providers/stub'
import { ThornSaferProvider } from './providers/thorn-safer'

// ─────────────────────────────────────────────────────────────────────────────
// CSAM provider factory. Mismo molde que src/lib/kyc/index.ts.
// ─────────────────────────────────────────────────────────────────────────────

export * from './provider'
export { StubCsamProvider } from './providers/stub'
export { ThornSaferProvider } from './providers/thorn-safer'

/** Providers built-in que la factory construye sin cableado extra. */
const BUILT_IN_PROVIDERS = ['stub'] as const

/**
 * Resuelve el proveedor de CSAM desde `CSAM_VENDOR`. Default: `'stub'`
 * (determinístico, sin red — SOLO scaffolding). El vendor real se selecciona
 * con `CSAM_VENDOR=thorn-safer` y se activa por `isCsamEnabled()` (CSAM_API_KEY).
 *
 * Agregar un vendor: implementar `CsamProvider` en
 * src/lib/csam/providers/<name>.ts y sumar un case abajo.
 */
export function getCsamProvider(): CsamProvider {
  const id = (process.env.CSAM_VENDOR ?? 'stub').trim() || 'stub'

  switch (id) {
    case 'stub':
      return new StubCsamProvider()
    case 'thorn-safer':
      // Esqueleto: scan() es fail-closed hasta que haya credenciales + adapter.
      return new ThornSaferProvider()
    default:
      throw new Error(
        `[csam] Unknown CSAM_VENDOR="${id}". Built-in: ${BUILT_IN_PROVIDERS.join(', ')} (+ 'thorn-safer' skeleton). ` +
          `To add another, implement the CsamProvider interface in ` +
          `src/lib/csam/providers/<name>.ts and register it in src/lib/csam/index.ts.`,
      )
  }
}
