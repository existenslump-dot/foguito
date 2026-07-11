import 'server-only'
import { isProduction } from '../config'
import type { AgeVerifyProvider, AgeVerifyStartInput } from '../provider'

// ─────────────────────────────────────────────────────────────────────────────
// StubAgeVerifyProvider — SOLO SCAFFOLDING. NOT a real age-verification vendor.
// ─────────────────────────────────────────────────────────────────────────────
//
// DETERMINISTIC and NETWORK-FREE: it makes the start → redirect → webhook →
// gate pipeline testable in dev/CI without a vendor. It does NOT verify anyone:
// `startVerification` returns a deterministic INTERNAL dev URL (inert — there is
// no stub webhook that would ever write an `age_gate_verifications` row), so in
// dev the fan can exercise the flow but never actually passes the gate.
//
// ⚠️ In production this protects nothing on its own — which is why it FAILS
// CLOSED there: `startVerification` throws. The real verification lives in
// providers/didit.ts and turns on with credentials (`isAgeVerifyEnabled()`).
// ─────────────────────────────────────────────────────────────────────────────

export class StubAgeVerifyProvider implements AgeVerifyProvider {
  readonly name = 'stub'

  async startVerification(input: AgeVerifyStartInput): Promise<{ url: string }> {
    // FAIL-CLOSED in production: the stub can't certify age in prod. Configure a
    // real AGE_VERIFY_API_KEY + NEXT_PUBLIC_AGE_VERIFY_PROVIDER instead.
    if (isProduction()) {
      throw new Error(
        '[age-gate] StubAgeVerifyProvider must not run in production — configure a real age-verification vendor (fail-closed)',
      )
    }

    // Deterministic internal dev URL. Purely informational: it does NOT complete
    // a verification (no stub webhook), so the gate stays closed even in dev.
    const params = new URLSearchParams({
      provider: this.name,
      user: input.userId,
      jurisdiction: input.jurisdiction,
    })
    return { url: `/verificar-edad?stub=1&${params.toString()}` }
  }
}
