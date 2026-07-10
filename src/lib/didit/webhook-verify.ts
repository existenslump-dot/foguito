import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Signature verification for Didit webhooks.
 *
 * Ported faithfully from the official implementation (didit-full-demo). Didit
 * sends THREE signature headers on every webhook and the reference tries them
 * in order:
 *
 *   1. x-signature-v2     — HMAC-SHA256 over `stableStringify(shortenFloats(body))`
 *                           (canonical JSON: sorted keys, floats→int when
 *                           applicable). Preferred (robust to UTF-8 encoding).
 *   2. x-signature-simple — HMAC over `timestamp:session_id:status:webhook_type`
 *                           (immune to JSON encoding issues).
 *   3. x-signature        — HMAC over the raw body (last resort; zero
 *                           normalization ambiguity, almost always matches).
 *
 * The freshness timestamp comes from the body (`created_at`, Unix seconds), NOT
 * from a header. Tolerance window: 300 s.
 *
 * Pure — no Next/Supabase — so the HMAC can be tested in isolation. `nowSeconds`
 * is injectable to avoid depending on the real clock in tests.
 */

export type DiditVerifyResult =
  | { ok: true; method: 'v2' | 'simple' | 'original' }
  | { ok: false; reason: string }

const TOLERANCE_SECONDS = 300

/** Normalizes floats that are integers in disguise (12.0 → 12), recursive. */
export function shortenFloats(data: unknown): unknown {
  if (data === null || data === undefined) return data
  if (Array.isArray(data)) return data.map(shortenFloats)
  if (typeof data === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = shortenFloats(value)
    }
    return result
  }
  if (
    typeof data === 'number' &&
    !Number.isInteger(data) &&
    Number.isInteger(Math.floor(data)) &&
    data === Math.floor(data)
  ) {
    return Math.floor(data)
  }
  return data
}

/** Deterministic JSON: sorted keys, no whitespace. */
export function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj)
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']'
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>).sort()
    const parts = keys.map((key) => {
      const value = (obj as Record<string, unknown>)[key]
      return JSON.stringify(key) + ':' + stableStringify(value)
    })
    return '{' + parts.join(',') + '}'
  }
  return JSON.stringify(obj)
}

function safeEqualHex(expectedHex: string, receivedHex: string): boolean {
  try {
    const a = Buffer.from(expectedHex, 'hex')
    const b = Buffer.from(receivedHex, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function isFresh(timestamp: unknown, nowSeconds: number): boolean {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return false
  return Math.abs(nowSeconds - timestamp) <= TOLERANCE_SECONDS
}

export function verifyDiditWebhook(params: {
  rawBody: string
  body: Record<string, unknown>
  signatures: {
    v2?: string | null
    simple?: string | null
    original?: string | null
  }
  secret: string
  /** Unix seconds. Defaults to `Date.now()/1000`. Injectable for tests. */
  nowSeconds?: number
}): DiditVerifyResult {
  const { rawBody, body, signatures, secret } = params
  if (!secret) return { ok: false, reason: 'no secret configured' }

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (!isFresh(body.created_at, now)) {
    return { ok: false, reason: 'stale or missing timestamp' }
  }

  // 1. V2 — canonical JSON
  if (signatures.v2) {
    const encoded = stableStringify(shortenFloats(body))
    const expected = createHmac('sha256', secret).update(encoded, 'utf-8').digest('hex')
    if (safeEqualHex(expected, signatures.v2)) return { ok: true, method: 'v2' }
  }

  // 2. Simple — canonical per-field string
  if (signatures.simple) {
    const canonical = [
      String(body.timestamp ?? body.created_at ?? ''),
      String(body.session_id ?? ''),
      String(body.status ?? ''),
      String(body.webhook_type ?? ''),
    ].join(':')
    const expected = createHmac('sha256', secret).update(canonical, 'utf-8').digest('hex')
    if (safeEqualHex(expected, signatures.simple)) return { ok: true, method: 'simple' }
  }

  // 3. Original — raw body
  if (signatures.original) {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    if (safeEqualHex(expected, signatures.original)) return { ok: true, method: 'original' }
  }

  return { ok: false, reason: 'signature mismatch' }
}
