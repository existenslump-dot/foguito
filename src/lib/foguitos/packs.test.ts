// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { FOGUITO_PACKS, getPack } from './packs'

describe('foguitos/packs', () => {
  it('getPack devuelve cada pack conocido del catálogo', () => {
    for (const pack of FOGUITO_PACKS) {
      expect(getPack(pack.id)).toEqual(pack)
    }
  })

  it('getPack devuelve null para un id desconocido', () => {
    expect(getPack('pack_nope')).toBeNull()
    expect(getPack('')).toBeNull()
    // Un id no-string (defensivo) también es null.
    expect(getPack(undefined as unknown as string)).toBeNull()
  })

  it('todo pack tiene foguitos y precio positivos, moneda USD', () => {
    for (const pack of FOGUITO_PACKS) {
      expect(pack.foguitos).toBeGreaterThan(0)
      expect(pack.priceAmount).toBeGreaterThan(0)
      expect(pack.priceCurrency).toBe('USD')
    }
  })

  it('los ids del catálogo son únicos', () => {
    const ids = FOGUITO_PACKS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
