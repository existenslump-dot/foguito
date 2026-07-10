import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Symmetric encryption for the KYC decision payload.
 *
 * Didit's verification record contains PII extracted from the document (name,
 * document number, date of birth). The design choice is "full encrypted
 * payload": it is persisted encrypted with AES-256-GCM (confidentiality +
 * authenticated integrity) in the
 * `verification_sessions.decision_payload_encrypted` column.
 *
 * Envelope: `v1.<iv_b64>.<tag_b64>.<ciphertext_b64>`. The version prefix leaves
 * the door open to algorithm/key rotation without breaking old records.
 *
 * The key (`DIDIT_PAYLOAD_KEY`) is 32 bytes (256 bits) in hex (64 chars) or
 * base64. Generate it with: `openssl rand -hex 32`.
 *
 * NEVER import from a Client Component — `server-only` enforces that at build.
 */

const ALGO = 'aes-256-gcm'
const IV_LEN = 12 // GCM: recommended 96-bit IV
const VERSION = 'v1'

function loadKey(): Buffer {
  const raw = process.env.DIDIT_PAYLOAD_KEY
  if (!raw) {
    throw new Error('[didit/crypto] DIDIT_PAYLOAD_KEY is not set')
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(
      '[didit/crypto] DIDIT_PAYLOAD_KEY must decode to 32 bytes (256-bit). ' +
        'Generate it with `openssl rand -hex 32`.',
    )
  }
  return key
}

/** Encrypts a string. Returns the versioned envelope. */
export function encryptString(plaintext: string): string {
  const key = loadKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.')
}

/** Decrypts an envelope produced by `encryptString`. */
export function decryptString(envelope: string): string {
  const key = loadKey()
  const parts = envelope.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('[didit/crypto] malformed envelope or unknown version')
  }
  const [, ivB64, tagB64, ctB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const ct = Buffer.from(ctB64, 'base64')
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** Encrypts a JSON-serializable object. */
export function encryptJson(value: unknown): string {
  return encryptString(JSON.stringify(value))
}

/** Decrypts and parses an envelope back to JSON. */
export function decryptJson<T = unknown>(envelope: string): T {
  return JSON.parse(decryptString(envelope)) as T
}
