/**
 * Shared crawler / social-card bot allowlist.
 *
 * PURE + edge-safe (only regex + a string test) — safe to import from the edge
 * middleware AND from server components. Extracted from src/middleware.ts so the
 * SAME allowlist governs every place that must exempt bots:
 *   - the geo-block (middleware): crawlers hit from US datacenters and would get
 *     redirected to /blocked, killing indexation.
 *   - the age-gate (src/app/[city]/layout.tsx): a crawler can't verify age, so
 *     gating it would hide all content from search engines.
 *
 * A single source of truth here means the two gates can't drift apart (a bot
 * exempted from one but caught by the other would be a subtle SEO/UX bug).
 *
 * This is the allowed form of "cloaking": bots see the same content a human will
 * see once past the gate, just without the login/verification friction.
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
