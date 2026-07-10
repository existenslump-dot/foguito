/**
 * IndexNow submission — notifies Bing + Yandex (and Seznam, Naver) that a
 * set of URLs has changed so they re-crawl faster than their usual
 * schedule. Zero-op if INDEXNOW_KEY is not configured so the caller never
 * has to branch on whether the feature is enabled.
 *
 * Ownership of the key is proved via `/{KEY}.txt` served by the
 * middleware (see src/middleware.ts — IndexNow ownership verification).
 */

const HOST = 'example.com'
const ENDPOINT = 'https://api.indexnow.org/indexnow'

/**
 * Submit one or more URLs to IndexNow. Fire-and-forget: we don't retry on
 * failure because IndexNow's SLA is best-effort anyway and a blocked
 * admin flow on a crawler ping would be worse than a silent miss.
 *
 * Returns a summary object for logging / observability (not awaited by
 * most callers). Callers should use `void submitIndexNow(...)` so a
 * thrown error doesn't bubble into the critical path.
 */
export async function submitIndexNow(urls: string[]): Promise<{
  ok:      boolean
  status?: number
  skipped?: 'no-key' | 'no-urls'
  error?:  string
}> {
  const key = process.env.INDEXNOW_KEY
  if (!key)           return { ok: false, skipped: 'no-key'  }
  if (urls.length === 0) return { ok: false, skipped: 'no-urls' }

  try {
    const res = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host:        HOST,
        key,
        keyLocation: `https://${HOST}/${key}.txt`,
        urlList:     urls,
      }),
      // Don't let a slow IndexNow response stall the caller. 5s is well
      // above the typical 50-200ms the API returns in.
      signal: AbortSignal.timeout(5000),
    })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown IndexNow error' }
  }
}
