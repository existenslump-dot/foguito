import { describe, expect, it, vi, beforeEach } from 'vitest'

// The config captures the blog envs into module-scoped literals on first
// import, so each case sets the env, resets the registry and re-imports.
// This locks the generalization: forum slugs derive from the market config
// (nothing hardcoded per country) and the section taxonomy is deployment
// config with the curated defaults.
async function importConfig(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const key of ['MARKET_COUNTRY_SLUG', 'BLOG_CITY_SLUGS']) {
    const v = env[key]
    if (v === undefined) delete process.env[key]
    else process.env[key] = v
  }
  return import('./marketplace.config')
}

describe('blog config (forum generalization)', () => {
  beforeEach(() => {
    delete process.env.MARKET_COUNTRY_SLUG
    delete process.env.BLOG_CITY_SLUGS
  })

  it('citySlugs default to the market country slug', async () => {
    const { MARKETPLACE } = await importConfig({})
    expect(MARKETPLACE.blog.citySlugs).toEqual(['us'])
  })

  it('citySlugs follow MARKET_COUNTRY_SLUG — no hardcoded country', async () => {
    const { MARKETPLACE } = await importConfig({ MARKET_COUNTRY_SLUG: 'argentina' })
    expect(MARKETPLACE.blog.citySlugs).toEqual(['argentina'])
  })

  it('BLOG_CITY_SLUGS appends legacy aliases, deduped, canonical first', async () => {
    const { MARKETPLACE } = await importConfig({
      MARKET_COUNTRY_SLUG: 'argentina',
      BLOG_CITY_SLUGS: 'buenos-aires, argentina',
    })
    expect(MARKETPLACE.blog.citySlugs).toEqual(['argentina', 'buenos-aires'])
  })

  it('default taxonomy: one listed admin-only section + unlisted community sections', async () => {
    const { MARKETPLACE } = await importConfig({})
    const sections = MARKETPLACE.blog.sections
    expect(sections.map(s => s.id)).toEqual(['guias', 'consultas', 'experiencias'])

    const listed = sections.filter(s => s.listed !== false)
    expect(listed.map(s => s.id)).toEqual(['guias'])
    expect(listed[0].adminOnly).toBe(true)

    // Community sections accept posts (not adminOnly) even while unlisted.
    for (const s of sections.filter(s => s.listed === false)) {
      expect(s.adminOnly).toBe(false)
    }
  })
})
