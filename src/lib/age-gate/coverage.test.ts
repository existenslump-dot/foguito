// @vitest-environment node
/**
 * AGE-GATE COVERAGE INVARIANT (PILAR #0 — bloqueante).
 *
 * The consumer age-gate is enforced by `enforceAgeGateOrRedirect`, wired into a
 * server `layout.tsx` that fronts each content-viewing route. A route that
 * renders creator content to a fan WITHOUT a gating ancestor layout is a
 * silent bypass (this is exactly how `/perfil/[slug]` slipped the gate in PR-4).
 *
 * This test locks that down two ways:
 *   1. Every KNOWN content route must resolve to an ancestor `layout.tsx` that
 *      calls `enforceAgeGateOrRedirect` (documents intent; breaks if a gate is
 *      removed).
 *   2. Every `page.tsx` that renders creator content (imports `PostDetailView`
 *      or `GeoFeedPage`, the fan-facing render components) must ALSO be
 *      gate-covered — so a FUTURE content route added without a gate fails here.
 *
 * Plus it pins FIX-1: the age-gate must NOT trust the User-Agent (no `isCrawler`
 * short-circuit), because a forgeable UA would open the gate in one header.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const APP_ROOT = path.join(process.cwd(), 'src', 'app')
const GATE_CALL = 'enforceAgeGateOrRedirect'

/**
 * Walk up from a page's directory to `src/app`, returning the first ancestor
 * `layout.tsx` (inclusive of the page's own dir) that invokes the gate, or null.
 */
function findGatingLayout(pageRelPath: string): string | null {
  let dir = path.dirname(pageRelPath)
  for (;;) {
    const layoutAbs = path.join(APP_ROOT, dir, 'layout.tsx')
    if (fs.existsSync(layoutAbs) && fs.readFileSync(layoutAbs, 'utf8').includes(GATE_CALL)) {
      return path.join(dir, 'layout.tsx')
    }
    if (dir === '.' || dir === '') break
    dir = path.dirname(dir)
  }
  return null
}

/** Recursively collect every `page.tsx` under `src/app` (paths relative to it). */
function allPages(dir = ''): string[] {
  const abs = path.join(APP_ROOT, dir)
  const out: string[] = []
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...allPages(rel))
    else if (entry.name === 'page.tsx') out.push(rel)
  }
  return out
}

/** Fan-facing creator-content render components. A page importing one of these
 *  renders content and therefore must sit behind the age-gate. */
const CONTENT_RENDER_MARKERS = ['PostDetailView', 'GeoFeedPage']

function rendersCreatorContent(pageRelPath: string): boolean {
  const src = fs.readFileSync(path.join(APP_ROOT, pageRelPath), 'utf8')
  return CONTENT_RENDER_MARKERS.some((m) => src.includes(m))
}

// Known fan content-consumption routes. Update deliberately when adding one —
// and only alongside a gating layout, or the assertion below fails.
const EXPECTED_CONTENT_ROUTES = [
  '[city]/page.tsx', // city feed + single-segment vanity `/{slug}` post detail
  '[city]/[...segments]/page.tsx', // nested geo feeds, SEO landings, post detail
  '[city]/post/[id]/page.tsx', // legacy post detail
  'perfil/[slug]/page.tsx', // public creator profile (thumbnail grid)
]

describe('age-gate coverage invariant', () => {
  it.each(EXPECTED_CONTENT_ROUTES)('gates the known content route %s via an ancestor layout', (route) => {
    expect(fs.existsSync(path.join(APP_ROOT, route)), `${route} should exist`).toBe(true)
    expect(
      findGatingLayout(route),
      `${route} must be covered by a layout calling ${GATE_CALL}()`,
    ).not.toBeNull()
  })

  it('gates EVERY page that renders creator content (catches new routes)', () => {
    const contentPages = allPages().filter(rendersCreatorContent)
    // Sanity: the scan must actually find the content routes, else the marker
    // heuristic silently matches nothing and the guard is vacuous.
    expect(contentPages.length).toBeGreaterThanOrEqual(3)

    const ungated = contentPages.filter((p) => findGatingLayout(p) === null)
    expect(
      ungated,
      `these content pages have no age-gate layout: ${ungated.join(', ')}`,
    ).toEqual([])
  })

  it('the age-gate does NOT trust the User-Agent (no isCrawler bypass) — FIX 1', () => {
    const enforce = fs.readFileSync(
      path.join(process.cwd(), 'src', 'lib', 'age-gate', 'enforce.ts'),
      'utf8',
    )
    const cityLayout = fs.readFileSync(path.join(APP_ROOT, '[city]', 'layout.tsx'), 'utf8')
    expect(enforce).not.toContain('isCrawler')
    expect(cityLayout).not.toContain('isCrawler')
  })
})
