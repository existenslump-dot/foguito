import 'server-only'

/**
 * Configuration + activation flag for the Didit KYC provider.
 *
 * Didit is selected as the verification vendor with `KYC_PROVIDER=didit`
 * (see src/lib/kyc/index.ts). On top of that, `isDiditEnabled()` gates the
 * provider at runtime on the PRESENCE of `DIDIT_API_KEY` + `DIDIT_WORKFLOW_ID`:
 * without those credentials every Didit UI/endpoint stays dormant and the
 * built-in `manual` flow (upload to the `identity-documents` bucket + admin
 * review) remains the permanent fallback. This lets the integration ship to
 * production inert, activated only once the credentials are loaded.
 */

/** Base URL of Didit's verification API. */
export const DIDIT_VERIFICATION_BASE = 'https://verification.didit.me/v3'

/** Is the Didit integration configured? (runtime activation flag) */
export function isDiditEnabled(): boolean {
  return Boolean(process.env.DIDIT_API_KEY && process.env.DIDIT_WORKFLOW_ID)
}

/** API key (`x-api-key` header). Throws if missing — call after `isDiditEnabled()`. */
export function diditApiKey(): string {
  const key = process.env.DIDIT_API_KEY
  if (!key) throw new Error('[didit] DIDIT_API_KEY is not set')
  return key
}

/** KYC workflow (document + liveness + face match) configured in the Didit console. */
export function diditWorkflowId(): string {
  const id = process.env.DIDIT_WORKFLOW_ID
  if (!id) throw new Error('[didit] DIDIT_WORKFLOW_ID is not set')
  return id
}

/** Secret used to verify the HMAC signature of inbound webhooks. */
export function diditWebhookSecret(): string {
  const secret = process.env.DIDIT_WEBHOOK_SECRET
  if (!secret) throw new Error('[didit] DIDIT_WEBHOOK_SECRET is not set')
  return secret
}
