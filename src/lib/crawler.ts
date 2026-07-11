/**
 * Shared crawler / social-card bot allowlist.
 *
 * PURE + edge-safe (only regex + a string test) — safe to import from the edge
 * middleware AND from server components. Extracted from src/middleware.ts so a
 * single allowlist governs the places that legitimately exempt bots:
 *   - the geo-block (middleware): crawlers hit from US datacenters and would get
 *     redirected to /blocked, killing indexation.
 *   - the BetaGate overlay bypass (middleware): bots skip the login friction.
 *
 * ⚠️ The consumer AGE-GATE deliberately does NOT use this allowlist. A UA string
 * is forgeable, so exempting bots there would be a trivial one-header bypass; the
 * gated adult surface is intentionally non-crawlable (it should not be indexed
 * anyway). Only the SFW landing / `/verificar-edad` pages, which sit OUTSIDE the
 * gate, stay indexable. See src/lib/age-gate/enforce.ts.
 *
 * This UA match is the allowed form of "cloaking" for the geo-block/BetaGate
 * only: bots see the same SFW surface a human will, without the login friction.
 */
export const BOT_UA_PATTERNS: RegExp[] = [
  // Search engines
  /googlebot/i, /google-inspectiontool/i, /adsbot-google/i, /apis-google/i,
  /bingbot/i, /adidxbot/i, /duckduckbot/i, /yandexbot/i, /baiduspider/i,
  /sogou/i, /applebot/i, /petalbot/i, /seznambot/i,
  // Social / link preview fetchers (OG image rendering)
  /facebookexternalhit/i, /facebookcatalog/i, /twitterbot/i, /linkedinbot/i,
  /slackbot/i, /discordbot/i, /telegrambot/i, /whatsapp/i, /pinterest/i,
  /skypeuripreview/i, /vkshare/i, /redditbot/i,
  // SEO tooling (optional — these don't rank your site but you may want them)
  /ahrefsbot/i, /semrushbot/i, /mj12bot/i, /dotbot/i,
]

export function isCrawler(userAgent: string): boolean {
  if (!userAgent) return false
  return BOT_UA_PATTERNS.some((p) => p.test(userAgent))
}
