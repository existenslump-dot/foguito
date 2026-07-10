import { describe, it, expect } from 'vitest'
import {
  hreflangAlternates,
  localeForCountry,
  organizationJsonLd,
  itemListJsonLd,
  profilePageJsonLd,
  jsonLdString,
} from './seo'

describe('localeForCountry', () => {
  it('returns the default-market locale for the default country slug', () => {
    // Defaults (no MARKET_* env): slug 'us', locale 'en' → hreflang 'en-US'.
    const loc = localeForCountry('us')
    expect(loc.hreflang).toBe('en-US')
    expect(loc.ogLocale).toBe('en_US')
    expect(loc.active).toBe(true)
  })

  it('falls back to the default market for unknown slugs', () => {
    expect(localeForCountry('unknown-country').hreflang).toBe('en-US')
    expect(localeForCountry('argentina').hreflang).toBe('en-US')
  })
})

describe('hreflangAlternates', () => {
  it('emits self + x-default for country-level path', () => {
    const alt = hreflangAlternates('/us')
    expect(alt['en-US']).toMatch(/\/us$/)
    expect(alt['x-default']).toMatch(/\/us$/)
  })

  it('preserves subpath across x-default', () => {
    const alt = hreflangAlternates('/us/capital-federal/palermo')
    expect(alt['en-US']).toMatch(/\/us\/capital-federal\/palermo$/)
    expect(alt['x-default']).toMatch(/\/us\/capital-federal\/palermo$/)
  })

  it('only emits active-market hreflangs (no inactive siblings)', () => {
    const alt = hreflangAlternates('/us')
    expect(alt['es-CL']).toBeUndefined()
    expect(alt['pt-BR']).toBeUndefined()
  })

  it('emits absolute URLs anchored on BASE_URL', () => {
    const alt = hreflangAlternates('/us')
    expect(alt['en-US']).toMatch(/^https?:\/\//)
  })

  it('returns empty object for root path', () => {
    expect(hreflangAlternates('/')).toEqual({})
  })
})

describe('organizationJsonLd', () => {
  it('produces a valid Organization schema', () => {
    const org = organizationJsonLd()
    expect(org['@type']).toBe('Organization')
    expect(org.name).toBe('Marketplace')
    expect(org.url).toMatch(/^https?:\/\//)
    expect(org.areaServed).toHaveLength(1) // only AR active
  })
})

describe('itemListJsonLd', () => {
  it('numbers list items starting at 1', () => {
    const list = itemListJsonLd(
      [
        { id: 'a', title: 'First',  post_slug: 'first'  },
        { id: 'b', title: 'Second', post_slug: 'second' },
      ],
      'argentina',
    )
    expect(list['@type']).toBe('ItemList')
    expect(list.numberOfItems).toBe(2)
    expect(list.itemListElement[0].position).toBe(1)
    expect(list.itemListElement[1].position).toBe(2)
    expect(list.itemListElement[0].url).toMatch(/\/argentina\/post\/first$/)
  })

  it('falls back to id when post_slug is null', () => {
    const list = itemListJsonLd([{ id: 'uuid-123', title: 'x' }], 'argentina')
    expect(list.itemListElement[0].url).toMatch(/\/post\/uuid-123$/)
  })
})

describe('profilePageJsonLd', () => {
  it('produces ProfilePage with Person mainEntity', () => {
    const pp = profilePageJsonLd(
      { title: 'Clara', description: 'desc', image_urls: ['img.jpg'], localidad: 'Palermo, CABA' },
      'https://example.com/argentina/post/clara',
    )
    expect(pp['@type']).toBe('ProfilePage')
    expect(pp.mainEntity['@type']).toBe('Person')
    expect(pp.mainEntity.name).toBe('Clara')
    expect(pp.mainEntity.image).toBe('img.jpg')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((pp.mainEntity as any).address?.addressLocality).toBe('Palermo, CABA')
  })

  it('omits address when localidad is missing', () => {
    const pp = profilePageJsonLd({ title: 'x' }, 'https://example.com/x')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((pp.mainEntity as any).address).toBeUndefined()
  })
})

describe('jsonLdString', () => {
  it('escapes </script> payload to prevent XSS', () => {
    const s = jsonLdString({ name: '</script><script>alert(1)' })
    expect(s).not.toContain('</script>')
    expect(s).toContain('\\u003c')
  })
})
