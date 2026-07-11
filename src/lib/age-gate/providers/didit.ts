import 'server-only'
import { isAgeVerifyEnabled } from '../config'
import type { AgeVerifyProvider, AgeVerifyStartInput } from '../provider'
import { createSession } from '@/lib/didit/client'

// ─────────────────────────────────────────────────────────────────────────────
// DiditAgeVerifyProvider — real vendor adapter (SKELETON) for viewer age
// assurance, reusing the Didit client from the KYC integration.
// ─────────────────────────────────────────────────────────────────────────────
//
// FAIL-CLOSED: without `isAgeVerifyEnabled()` credentials `startVerification`
// throws — the API route surfaces a 503 and no one passes the gate. With
// credentials it opens a real Didit hosted session and returns its URL.
//
// The result is applied ONLY by the signed webhook
// (src/app/api/webhooks/age-verify/route.ts), which reuses src/lib/didit/age.ts
// `deriveAge` to derive the ≥18 verdict from the returned decision's DOB (and a
// defensive `age_over_18` flag for pure age-estimation flows). This adapter only
// starts the flow; it never writes a verification row.
//
// TODO(vendor): `createSession` uses the KYC workflow (`DIDIT_WORKFLOW_ID`). For
// age assurance you'll typically point at a lighter age-estimation workflow —
// swap in a dedicated workflow id / client call here when it's provisioned.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encodes the fan's user id AND the captured viewer jurisdiction into Didit's
 * `vendor_data` (a single string echoed back, verbatim, inside the HMAC-signed
 * webhook body). Recovering both from one SIGNED field avoids a pending-session
 * table and can't be forged (full-body signature covers it).
 */
export function encodeVendorData(userId: string, jurisdiction: string): string {
  return JSON.stringify({ u: userId, j: jurisdiction })
}

export class DiditAgeVerifyProvider implements AgeVerifyProvider {
  readonly name = 'didit'

  async startVerification(input: AgeVerifyStartInput): Promise<{ url: string }> {
    if (!isAgeVerifyEnabled()) {
      // Fail-closed: no credentials ⇒ no verification can be started.
      throw new Error('age-verify provider not configured')
    }

    const session = await createSession({
      vendorData: encodeVendorData(input.userId, input.jurisdiction),
      callback: input.callbackUrl,
    })
    if (!session.ok) {
      throw new Error(`[age-gate/didit] createSession failed: ${session.error}`)
    }
    return { url: session.data.url }
  }
}
