import * as OTPAuth from 'otpauth'
import { createHash, randomBytes } from 'node:crypto'

/**
 * TOTP helpers for the admin 2FA flow.
 *
 * Custom-built rather than Supabase Auth MFA — the v12 attempt at the
 * built-in path was reverted after navigator.locks contention in
 * @supabase/ssr left the login UI hanging behind the MFA challenge.
 * Routing TOTP through our own endpoints stays clear of the SDK lock,
 * so the regression can't reappear.
 *
 * Stack: [otpauth](https://github.com/hectorm/otpauth) — actively
 * maintained, zero deps, supports the standard 30s / SHA-1 / 6-digit
 * profile every authenticator app (Google Authenticator, Authy,
 * 1Password, Bitwarden, Aegis) speaks out of the box. Allowing a ±1
 * window absorbs phone clock drift without widening the brute-force
 * window meaningfully (10⁶ codes × 3 windows = 3·10⁶, still beyond
 * online attacker reach with our 5-attempts-per-IP rate limit).
 */

const ISSUER = 'MARKETPLACE+'
const PERIOD = 30
const DIGITS = 6
const ALGORITHM = 'SHA1'

/** RFC 6238 / RFC 4226 compatible secret. otpauth's Secret class outputs
 *  base32, which is what every authenticator expects. 20 bytes (160 bits)
 *  matches the SHA-1 block used internally; longer secrets get truncated
 *  by the spec, shorter ones reduce entropy needlessly. */
export function generateSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32
}

export function otpauthUri(secret: string, accountLabel: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  })
  return totp.toString()
}

/**
 * Verify a 6-digit code against the stored secret. Returns the matched
 * counter delta (-1 / 0 / +1) on success, or null on mismatch. The
 * delta is exposed so callers can log "wrong by N steps" for telemetry
 * without leaking timing info to the client (we still return a flat
 * boolean to the user-facing endpoint).
 *
 * `window: 1` allows the previous and next 30-second window — phones
 * with up to ~30s of clock drift still authenticate, but a code from
 * 90 seconds ago is rejected.
 */
export function verifyCode(secret: string, code: string): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: 'verify',
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  })
  const delta = totp.validate({ token: code, window: 1 })
  return delta
}

/** Generate N single-use recovery codes. Each code is 10 base32 chars
 *  (50 bits of entropy) split into two groups of 5 with a dash for
 *  readability — matches GitHub / Google Authenticator style. The
 *  user copies the plaintext set once at setup and we store only the
 *  SHA-256 hashes, so a DB leak doesn't yield bypass codes. */
export function generateRecoveryCodes(n = 8): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    // crypto.randomBytes → base32 (RFC 4648 alphabet, no padding) keeps
    // codes alphanumeric and case-insensitive on the wire.
    const raw = randomBytes(7)
    const code = base32Encode(raw).slice(0, 10).toLowerCase()
    out.push(`${code.slice(0, 5)}-${code.slice(5)}`)
  }
  return out
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex')
}

/**
 * Verify a recovery code against the stored hash list. Returns the
 * matched index on success (so the caller can splice it out of the
 * array — codes are single-use), or -1 on mismatch.
 */
export function verifyRecoveryCode(plain: string, hashes: string[] | null | undefined): number {
  if (!hashes || hashes.length === 0) return -1
  const target = hashRecoveryCode(plain)
  return hashes.indexOf(target)
}

/** Tiny RFC 4648 base32 encoder — node has no built-in. otpauth ships
 *  one but only on its Secret class which would be wasteful to spin up
 *  per recovery code. */
function base32Encode(buf: Buffer): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let out = ''
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** Re-verification window: how long a successful TOTP verification
 *  keeps an admin session "fresh" before we force a re-prompt. 12h
 *  is the standard banking ballpark — long enough that an admin
 *  doesn't re-verify on every page-nav, short enough that a stolen
 *  cookie can't grant indefinite access. */
export const TOTP_VERIFY_TTL_MS = 12 * 60 * 60 * 1000
