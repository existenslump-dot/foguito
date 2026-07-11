import 'server-only'

/**
 * Configuration + activation flag for the consumer age-verification provider.
 *
 * Same mould as src/lib/didit/config.ts and src/lib/csam/config.ts: the real
 * vendor (Didit age-estimation / Yoti / …) is selected with
 * `NEXT_PUBLIC_AGE_VERIFY_PROVIDER` (see src/lib/age-gate/index.ts), and
 * `isAgeVerifyEnabled()` gates it at runtime on the PRESENCE of
 * `AGE_VERIFY_API_KEY` + `NEXT_PUBLIC_AGE_VERIFY_PROVIDER`. Without those the
 * built-in `stub` (deterministic, no network — SOLO scaffolding) is the
 * fallback, so the pipeline ships to production inert and turns on only once the
 * credentials are loaded.
 *
 * NB: the `stub` never certifies anyone in production (it throws — see
 * providers/stub.ts). Real fail-closed protection of pilar #0 requires a
 * configured vendor.
 *
 * NEVER import from a Client Component — `server-only` enforces that at build.
 */

/** Is the real age-verification vendor configured? (runtime activation flag) */
export function isAgeVerifyEnabled(): boolean {
  return Boolean(
    process.env.AGE_VERIFY_API_KEY && process.env.NEXT_PUBLIC_AGE_VERIFY_PROVIDER,
  )
}

/**
 * Are we in the PRODUCTION deploy? The stub must not verify in prod: without a
 * real vendor everything fails CLOSED (no `age_gate_verifications` row is ever
 * written), so an un-verified fan stays gated. The stub only emits in
 * dev/CI/preview.
 */
export function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

/** API key of the age-verification vendor. Throws if missing — call after `isAgeVerifyEnabled()`. */
export function ageVerifyApiKey(): string {
  const key = process.env.AGE_VERIFY_API_KEY
  if (!key) throw new Error('[age-gate] AGE_VERIFY_API_KEY is not set')
  return key
}

/** Secret used to verify the HMAC signature of inbound age-verify webhooks. Throws if missing. */
export function ageVerifyWebhookSecret(): string {
  const secret = process.env.AGE_VERIFY_WEBHOOK_SECRET
  if (!secret) throw new Error('[age-gate] AGE_VERIFY_WEBHOOK_SECRET is not set')
  return secret
}
