import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

/**
 * Distributed rate-limiter with in-memory fallback.
 *
 * Upstash Redis (REST) is the production store — it stays consistent
 * across Vercel serverless instances. The in-memory Map is the local /
 * preview / test fallback so dev keeps working without provisioning
 * Redis and so tests stay deterministic.
 *
 * Contract (unified async):
 *   `rateLimit(key, limit, windowMs)` → `{ success, retryAfter }`
 *   - `success: true`  → under the limit, proceed
 *   - `success: false` → over the limit, 429 with `Retry-After: retryAfter`
 *
 * The old split (`rateLimit()` boolean + `retryAfterSeconds()`) is gone —
 * Upstash returns the reset timestamp in the same response, so a single
 * call is both cheaper and race-free.
 *
 * Enablement: set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
 * in Vercel env vars. No code change required — the module switches on
 * first call once the env is present.
 */

// ── In-memory fallback ──────────────────────────────────────────────
// Fixed window, same behaviour as pre-migration. Only used when Upstash
// env vars are missing (dev, tests, preview without Redis provisioned).

type MemEntry = { count: number; resetAt: number }
const memStore = new Map<string, MemEntry>()
let lastCleanup = Date.now()

function memCleanup(now: number): void {
  // Sweep every 5 min so the Map doesn't grow unbounded on long-running
  // dev servers. Serverless cold starts already clear it — this is for
  // the `npm run dev` case.
  if (now - lastCleanup < 5 * 60 * 1000) return
  lastCleanup = now
  for (const [key, entry] of memStore) {
    if (now > entry.resetAt) memStore.delete(key)
  }
}

function memoryLimit(key: string, limit: number, windowMs: number): { success: boolean; retryAfter: number } {
  const now = Date.now()
  memCleanup(now)
  const entry = memStore.get(key)
  if (!entry || now > entry.resetAt) {
    memStore.set(key, { count: 1, resetAt: now + windowMs })
    return { success: true, retryAfter: 0 }
  }
  if (entry.count >= limit) {
    return { success: false, retryAfter: Math.max(0, Math.ceil((entry.resetAt - now) / 1000)) }
  }
  entry.count++
  return { success: true, retryAfter: 0 }
}

// ── Upstash Ratelimit ───────────────────────────────────────────────
// Each (limit, windowMs) pair gets its own Ratelimit instance — the SDK
// bakes the window into the instance at construction time. We cache
// instances so we don't rebuild (or reconnect) on every request.

type Duration = `${number} ms` | `${number} s` | `${number} m` | `${number} h` | `${number} d`

function msToDuration(ms: number): Duration {
  // Prefer the coarsest unit that divides cleanly so Upstash's internal
  // analytics stay readable (`1 h` rather than `3600000 ms`).
  if (ms % (24 * 60 * 60 * 1000) === 0) return `${ms / (24 * 60 * 60 * 1000)} d` as Duration
  if (ms % (60 * 60 * 1000) === 0)       return `${ms / (60 * 60 * 1000)} h` as Duration
  if (ms % (60 * 1000) === 0)            return `${ms / (60 * 1000)} m` as Duration
  if (ms % 1000 === 0)                   return `${ms / 1000} s` as Duration
  return `${ms} ms` as Duration
}

let redisSingleton: Redis | null = null
let redisProbeDone = false

function getRedis(): Redis | null {
  if (redisProbeDone) return redisSingleton
  redisProbeDone = true
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  redisSingleton = new Redis({ url, token })
  return redisSingleton
}

const limiterCache = new Map<string, Ratelimit>()

function getLimiter(limit: number, windowMs: number): Ratelimit | null {
  const redis = getRedis()
  if (!redis) return null
  const cacheKey = `${limit}:${windowMs}`
  let rl = limiterCache.get(cacheKey)
  if (!rl) {
    rl = new Ratelimit({
      redis,
      // Fixed window matches the semantics of the old in-memory impl —
      // a migration that doesn't change per-call behaviour. Sliding
      // window is an option later if we want smoother burst handling.
      limiter: Ratelimit.fixedWindow(limit, msToDuration(windowMs)),
      prefix:  'marketplace-rl',
      // Analytics off — uses Upstash data to no purpose for us and
      // doubles the request count on the free tier.
      analytics: false,
    })
    limiterCache.set(cacheKey, rl)
  }
  return rl
}

// ── Public API ───────────────────────────────────────────────────────

export type RateLimitResult = {
  success:    boolean
  retryAfter: number // seconds until reset; 0 when success=true
}

/**
 * Check the rate limit for a key. Always returns a resolved object —
 * never throws — so call sites can branch on `success` directly.
 *
 * On Upstash transport failure, falls through to the in-memory limiter
 * for that call. Better a degraded local limit than a 500 on every
 * auth request because Redis is momentarily unreachable.
 */
export async function rateLimit(
  key:      string,
  limit:    number,
  windowMs: number,
): Promise<RateLimitResult> {
  const upstash = getLimiter(limit, windowMs)
  if (upstash) {
    try {
      const { success, reset } = await upstash.limit(key)
      const retryAfter = success
        ? 0
        : Math.max(0, Math.ceil((reset - Date.now()) / 1000))
      return { success, retryAfter }
    } catch (err) {
      // Transient Upstash outage — degrade to in-memory so we don't
      // 500 the whole API. Logged so Sentry picks it up.
      console.warn('[rate-limit] Upstash error, falling back to in-memory:', err)
    }
  }
  return memoryLimit(key, limit, windowMs)
}

// ── Test-only reset helper ───────────────────────────────────────────
// Exported so the unit test suite can isolate runs without re-importing
// the module. Intentionally NOT used anywhere in production code.
export function __resetRateLimitForTests(): void {
  memStore.clear()
  lastCleanup = Date.now()
  limiterCache.clear()
  redisSingleton = null
  redisProbeDone = false
}
