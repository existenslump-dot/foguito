/**
 * Catálogo de packs de foguitos (dinero → foguitos) — PR-7 money-in.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ FUENTE ÚNICA server-authoritative del mapeo dinero → foguitos. TANTO el     │
 * │ checkout COMO el webhook resuelven montos DESDE ACÁ, jamás del cliente ni   │
 * │ del body del provider. El fan sólo manda un `packId`; el precio y la        │
 * │ cantidad de foguitos salen de este catálogo y se congelan en la orden.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ PRECIOS PLACEHOLDER — los fija el founder. La relación dinero↔foguitos y el
 * pricing real es una decisión de negocio; estos valores son sólo scaffolding
 * para embarcar el riel inerte y testeable.
 */

export type FoguitoPack = {
  id: string
  foguitos: number
  priceAmount: number
  priceCurrency: 'USD'
}

/* PLACEHOLDER — el founder fija los precios reales */
export const FOGUITO_PACKS: FoguitoPack[] = [
  { id: 'pack_500', foguitos: 500, priceAmount: 5, priceCurrency: 'USD' },
  { id: 'pack_1200', foguitos: 1200, priceAmount: 10, priceCurrency: 'USD' },
  { id: 'pack_2500', foguitos: 2500, priceAmount: 20, priceCurrency: 'USD' },
]

/**
 * Resuelve un pack por id. Devuelve `null` para un id desconocido — el checkout
 * lo trata como 400 (fail-closed: nunca se cobra por un pack fuera del catálogo).
 */
export function getPack(id: string): FoguitoPack | null {
  if (typeof id !== 'string' || id.length === 0) return null
  return FOGUITO_PACKS.find((p) => p.id === id) ?? null
}
