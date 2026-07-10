#!/usr/bin/env node
/**
 * Fetch the live sitemap.xml and verify every URL returns a 2xx.
 *
 * Catches the two easy regressions: (1) a page renames → sitemap points
 * at a 404 for weeks before Google flags it, (2) middleware starts
 * geo-blocking a path that Google is indexing. Run before big launches
 * or after routing refactors.
 *
 * Usage:
 *   node scripts/verify-sitemap.mjs                  # hits NEXT_PUBLIC_APP_URL
 *   node scripts/verify-sitemap.mjs https://preview.vercel.app
 *   BASE_URL=https://staging.example.com node scripts/verify-sitemap.mjs
 *
 * Exit codes:
 *   0 — all URLs returned 2xx (or 3xx with a 2xx Location target we didn't follow)
 *   1 — at least one URL returned 4xx/5xx
 *   2 — sitemap itself 404'd or parse failed
 *
 * Concurrency limit: 8 parallel requests. The sitemap for a busy
 * geo-cascade site can be thousands of URLs; serial would take minutes.
 */

const DEFAULT_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://your-domain.com'
const CONCURRENCY = 8
const TIMEOUT_MS = 10_000

const base = (process.argv[2] || process.env.BASE_URL || DEFAULT_BASE).replace(/\/$/, '')

console.log(`\nVerifying sitemap at ${base}/sitemap.xml\n`)

// ─── Fetch + parse sitemap ────────────────────────────────────────────
async function fetchSitemap() {
  const res = await fetch(`${base}/sitemap.xml`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) {
    console.error(`  ✗ sitemap.xml returned ${res.status}`)
    process.exit(2)
  }
  const xml = await res.text()
  // Naïve parse — sitemaps are simple <url><loc>...</loc></url> lists.
  // Avoids a DOMParser dependency at the cost of failing on weird XML
  // entities. Good enough for our own sitemap.
  const matches = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g))
  const urls = matches.map(m => m[1].trim())
  if (urls.length === 0) {
    console.error(`  ✗ sitemap.xml had zero <loc> entries — parse failed or empty`)
    process.exit(2)
  }
  return urls
}

// ─── Bounded parallel URL checker ──────────────────────────────────────
async function checkUrl(url) {
  try {
    // HEAD first; if the server rejects HEAD (some CDNs), fall back to GET.
    let res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' })
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' })
    }
    return { url, status: res.status, location: res.headers.get('location') ?? undefined }
  } catch (err) {
    return { url, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = []
  let i = 0
  async function run() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await worker(items[idx])
    }
  }
  await Promise.all(Array.from({ length: limit }, run))
  return results
}

// ─── Main ──────────────────────────────────────────────────────────────
const urls = await fetchSitemap()
console.log(`  ${urls.length} URLs to check\n`)

const results = await runWithConcurrency(urls, CONCURRENCY, checkUrl)

const ok   = results.filter(r => r.status >= 200 && r.status < 300)
const redir = results.filter(r => r.status >= 300 && r.status < 400)
const bad  = results.filter(r => r.status >= 400 || r.status === 0)

for (const r of bad) {
  const label = r.status === 0 ? 'ERR' : r.status
  console.log(`  ✗ ${label}  ${r.url}${r.error ? `  (${r.error})` : ''}`)
}
for (const r of redir) {
  console.log(`  → ${r.status}  ${r.url}${r.location ? `  → ${r.location}` : ''}`)
}

console.log('')
console.log(`  ok: ${ok.length}   redirects: ${redir.length}   failures: ${bad.length}`)
console.log('')

process.exit(bad.length > 0 ? 1 : 0)
