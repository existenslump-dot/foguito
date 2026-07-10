import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  KycProvider,
  KycStartInput,
  KycStartResult,
  KycStatus,
} from '../provider'

// ─────────────────────────────────────────────────────────────────────────────
// ManualKycProvider — the built-in, homegrown verification flow.
// ─────────────────────────────────────────────────────────────────────────────
//
// Thin adapter over the EXISTING in-app flow. It does NOT own the upload or
// admin-review logic — that still lives in /dashboard/verify,
// /api/admin/verification, /api/admin/identity-upload etc. This class only
// fronts those so the rest of the app can talk to a `KycProvider`:
//
//   - startVerification → `{ mode: 'internal' }`, meaning "render the built-in
//     /dashboard/verify upload flow". No vendor session to open.
//   - getStatus → reads `profiles.verification_status` via a supplied Supabase
//     client (server-side admin or a user-scoped client both work; the caller
//     decides which to inject).
//   - handleCallback → not implemented: the manual flow is review-driven, not
//     webhook-driven, so the optional method is omitted.
// ─────────────────────────────────────────────────────────────────────────────

/** Normalize a raw `profiles.verification_status` value to a `KycStatus`. */
function normalizeStatus(raw: unknown): KycStatus {
  switch (raw) {
    case 'pending':
    case 'approved':
    case 'rejected':
      return raw
    default:
      // null / 'unverified' / legacy values → treat as never-started.
      return 'unverified'
  }
}

export class ManualKycProvider implements KycProvider {
  readonly name = 'manual'

  /**
   * @param supabase Client used by `getStatus` to read `profiles`. Injected so
   *   the provider stays free of client-creation concerns (the caller picks
   *   service-role vs. user-scoped). When omitted, `getStatus` reports
   *   `unverified` (defensive default — no client, no status).
   */
  constructor(private readonly supabase?: SupabaseClient) {}

  async startVerification(_input: KycStartInput): Promise<KycStartResult> {
    // The manual flow is entirely in-app: hand the caller back to the built-in
    // /dashboard/verify upload UI. No redirect URL, no SDK session token.
    return { mode: 'internal' }
  }

  async getStatus(userId: string): Promise<KycStatus> {
    if (!this.supabase) return 'unverified'
    const { data, error } = await this.supabase
      .from('profiles')
      .select('verification_status')
      .eq('id', userId)
      .maybeSingle()
    if (error || !data) return 'unverified'
    return normalizeStatus(data.verification_status)
  }

  // handleCallback intentionally omitted — no webhook for the manual flow.
}
