import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseMock } from '@/test/mocks/supabase'
import {
  buildGeoUrl,
  getGeoDisplayName,
  getGeoBreadcrumb,
  deepestFk,
  resolveGeoPath,
  LEGACY_CITY_REDIRECTS,
  type GeoPath,
} from '@/lib/geo'

const country   = { id: 'co1', slug: 'argentina',       name: 'Argentina',       code: 'AR', active: true }
const provincia = { id: 'pr1', country_id: 'co1', slug: 'buenos-aires', name: 'Buenos Aires', active: true, sort_order: 2 }
const comuna    = { id: 'cm1', provincia_id: 'pr1', slug: 'zona-norte', name: 'Zona Norte',   active: true, sort_order: 7 }
const barrio    = { id: 'br1', comuna_id: 'cm1',     slug: 'benavidez',  name: 'Benavidez',    active: true, sort_order: 1 }

describe('buildGeoUrl', () => {
  it('builds a country-only URL', () => {
    expect(buildGeoUrl({ country })).toBe('/argentina')
  })
  it('builds a provincia URL', () => {
    expect(buildGeoUrl({ country, provincia })).toBe('/argentina/buenos-aires')
  })
  it('builds a comuna URL', () => {
    expect(buildGeoUrl({ country, provincia, comuna })).toBe('/argentina/buenos-aires/zona-norte')
  })
  it('builds a barrio URL (4 segments)', () => {
    expect(buildGeoUrl({ country, provincia, comuna, barrio }))
      .toBe('/argentina/buenos-aires/zona-norte/benavidez')
  })
})

describe('getGeoDisplayName', () => {
  it('returns country name when nothing deeper is set', () => {
    expect(getGeoDisplayName({ country })).toBe('Argentina')
  })
  it('returns provincia name when it is the deepest', () => {
    expect(getGeoDisplayName({ country, provincia })).toBe('Buenos Aires')
  })
  it('returns the deepest available level', () => {
    expect(getGeoDisplayName({ country, provincia, comuna, barrio })).toBe('Benavidez')
  })
})

describe('getGeoBreadcrumb', () => {
  it('joins all levels from deepest to shallowest', () => {
    const path: GeoPath = { country, provincia, comuna, barrio }
    expect(getGeoBreadcrumb(path)).toBe('Benavidez, Zona Norte, Buenos Aires, Argentina')
  })
  it('skips missing levels', () => {
    expect(getGeoBreadcrumb({ country, provincia })).toBe('Buenos Aires, Argentina')
  })
})

describe('deepestFk', () => {
  it('returns country_id when only country is set', () => {
    expect(deepestFk({ country })).toEqual({ column: 'country_id', id: 'co1' })
  })
  it('returns provincia_id when provincia is deepest', () => {
    expect(deepestFk({ country, provincia })).toEqual({ column: 'provincia_id', id: 'pr1' })
  })
  it('returns comuna_id when comuna is deepest', () => {
    expect(deepestFk({ country, provincia, comuna })).toEqual({ column: 'comuna_id', id: 'cm1' })
  })
  it('returns barrio_id when all 4 levels are set', () => {
    expect(deepestFk({ country, provincia, comuna, barrio })).toEqual({ column: 'barrio_id', id: 'br1' })
  })
})

describe('LEGACY_CITY_REDIRECTS', () => {
  it('is currently empty', () => {
    expect(Object.keys(LEGACY_CITY_REDIRECTS)).toHaveLength(0)
  })
})

describe('resolveGeoPath', () => {
  it('returns null for empty segments', async () => {
    const supabase = createSupabaseMock() as unknown as SupabaseClient
    expect(await resolveGeoPath(supabase, [])).toBeNull()
  })

  it('returns null for too many segments (>4)', async () => {
    const supabase = createSupabaseMock() as unknown as SupabaseClient
    expect(await resolveGeoPath(supabase, ['a', 'b', 'c', 'd', 'e'])).toBeNull()
  })

  it('returns null when country slug does not exist', async () => {
    const supabase = createSupabaseMock({ countries: [] }) as unknown as SupabaseClient
    expect(await resolveGeoPath(supabase, ['narnia'])).toBeNull()
  })

  it('resolves country-only path', async () => {
    const supabase = createSupabaseMock({ countries: [country] }) as unknown as SupabaseClient
    const geo = await resolveGeoPath(supabase, ['argentina'])
    expect(geo).not.toBeNull()
    expect(geo?.country.slug).toBe('argentina')
    expect(geo?.provincia).toBeUndefined()
  })

  it('resolves provincia path', async () => {
    const supabase = createSupabaseMock({
      countries: [country],
      provincias: [provincia],
    }) as unknown as SupabaseClient
    const geo = await resolveGeoPath(supabase, ['argentina', 'buenos-aires'])
    expect(geo?.provincia?.slug).toBe('buenos-aires')
  })

  it('resolves full 4-segment path', async () => {
    const supabase = createSupabaseMock({
      countries:  [country],
      provincias: [provincia],
      comunas:    [comuna],
      barrios:    [barrio],
    }) as unknown as SupabaseClient
    const geo = await resolveGeoPath(supabase, ['argentina', 'buenos-aires', 'zona-norte', 'benavidez'])
    expect(geo?.barrio?.slug).toBe('benavidez')
    expect(getGeoDisplayName(geo!)).toBe('Benavidez')
    expect(buildGeoUrl(geo!)).toBe('/argentina/buenos-aires/zona-norte/benavidez')
  })
})
