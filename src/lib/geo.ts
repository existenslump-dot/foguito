/**
 * URL format: /{country}/{provincia}/{comuna?}/{barrio?}  (2-4 segments).
 * The deepest non-null FK on a post defines its canonical location.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { MARKETPLACE } from '@/config/marketplace.config'

export type Country   = { id: string; slug: string; name: string; code: string; active: boolean }
export type Provincia = { id: string; country_id: string; slug: string; name: string; active: boolean; sort_order: number }
export type Comuna    = { id: string; provincia_id: string; slug: string; name: string; active: boolean; sort_order: number }
export type Barrio    = { id: string; comuna_id: string; slug: string; name: string; active: boolean; sort_order: number }

export type GeoPath = {
  country:    Country
  provincia?: Provincia
  comuna?:    Comuna
  barrio?:    Barrio
}

// Legacy URL slug aliases — kept for backward compat redirects only.
export const LEGACY_CITY_REDIRECTS: Record<string, string> = {}

/**
 * Segments are positional: [country, provincia?, comuna?, barrio?].
 * Returns null if any segment fails to match at its expected depth.
 */
export async function resolveGeoPath(
  supabase: SupabaseClient,
  segments: string[],
): Promise<GeoPath | null> {
  if (segments.length === 0 || segments.length > 4) return null

  const [countrySlug, provinciaSlug, comunaSlug, barrioSlug] = segments.map(s => s.toLowerCase())

  const { data: country } = await supabase
    .from('countries')
    .select('id, slug, name, code, active')
    .eq('slug', countrySlug)
    .eq('active', true)
    .maybeSingle()
  if (!country) return null

  const path: GeoPath = { country: country as Country }
  if (!provinciaSlug) return path

  const { data: provincia } = await supabase
    .from('provincias')
    .select('id, country_id, slug, name, active, sort_order')
    .eq('country_id', country.id)
    .eq('slug', provinciaSlug)
    .eq('active', true)
    .maybeSingle()
  if (!provincia) return null

  path.provincia = provincia as Provincia
  if (!comunaSlug) return path

  const { data: comuna } = await supabase
    .from('comunas')
    .select('id, provincia_id, slug, name, active, sort_order')
    .eq('provincia_id', provincia.id)
    .eq('slug', comunaSlug)
    .eq('active', true)
    .maybeSingle()
  if (!comuna) return null

  path.comuna = comuna as Comuna
  if (!barrioSlug) return path

  const { data: barrio } = await supabase
    .from('barrios')
    .select('id, comuna_id, slug, name, active, sort_order')
    .eq('comuna_id', comuna.id)
    .eq('slug', barrioSlug)
    .eq('active', true)
    .maybeSingle()
  if (!barrio) return null

  path.barrio = barrio as Barrio
  return path
}

export function buildGeoUrl(path: GeoPath): string {
  const segments = [path.country.slug]
  if (path.provincia) segments.push(path.provincia.slug)
  if (path.comuna)    segments.push(path.comuna.slug)
  if (path.barrio)    segments.push(path.barrio.slug)
  return '/' + segments.join('/')
}

/** Shortest meaningful display name — uses the deepest available level. */
export function getGeoDisplayName(path: GeoPath): string {
  return path.barrio?.name
      ?? path.comuna?.name
      ?? path.provincia?.name
      ?? path.country.name
}

/** Full breadcrumb-style display (e.g. "Palermo, Capital Federal, Argentina"). */
export function getGeoBreadcrumb(path: GeoPath): string {
  return [path.barrio?.name, path.comuna?.name, path.provincia?.name, path.country.name]
    .filter(Boolean)
    .join(', ')
}

/** Deepest FK on a GeoPath — used to filter posts at the right granularity. */
export function deepestFk(path: GeoPath): { column: 'barrio_id' | 'comuna_id' | 'provincia_id' | 'country_id'; id: string } {
  if (path.barrio)    return { column: 'barrio_id',    id: path.barrio.id }
  if (path.comuna)    return { column: 'comuna_id',    id: path.comuna.id }
  if (path.provincia) return { column: 'provincia_id', id: path.provincia.id }
  return { column: 'country_id', id: path.country.id }
}

/**
 * Minimal shape for posts that include joined geo relations. Accepts either
 * the full `Post` type or any object with the same optional relation fields
 * (e.g. joined rows from `reports.select('*, posts(..., countries(slug))')`).
 *
 * Supabase embeds many-to-one relations as either an object or a single-
 * element array depending on typing config — both forms are accepted.
 */
type GeoRelation = { slug?: string; name?: string }
type GeoRelations = {
  country_id?: string | null
  countries?:  GeoRelation | GeoRelation[] | null
  provincias?: GeoRelation | GeoRelation[] | null
  comunas?:    GeoRelation | GeoRelation[] | null
  barrios?:    GeoRelation | GeoRelation[] | null
  localidad?:  string | null
}

/**
 * Normalize a Supabase embedded relation that might come back as either an
 * object or a single-element array. Returns null if the relation is absent.
 */
export function pickRelation<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel
}

/** Country name from a joined `countries(name)` relation. */
export function postCountryName(post: GeoRelations | null | undefined): string {
  return pickRelation(post?.countries)?.name || ''
}

/**
 * Country slug for post URLs (e.g. `/${postCountrySlug(post)}/post/${id}`).
 *
 * Requires the query to JOIN `countries(slug)` — without the join the
 * helper falls back to the default market slug (`market.defaultCountrySlug`).
 */
export function postCountrySlug(post: GeoRelations | null | undefined): string {
  return pickRelation(post?.countries)?.slug || MARKETPLACE.market.defaultCountrySlug
}

/**
 * Human-readable location — uses `localidad` (denormalized breadcrumb text)
 * first, then the deepest joined relation name, falling back to country.
 */
export function postGeoDisplay(post: GeoRelations | null | undefined): string {
  if (!post) return ''
  if (post.localidad) return post.localidad
  return pickRelation(post.barrios)?.name
      ?? pickRelation(post.comunas)?.name
      ?? pickRelation(post.provincias)?.name
      ?? pickRelation(post.countries)?.name
      ?? ''
}

export async function fetchActiveCountries(supabase: SupabaseClient): Promise<Country[]> {
  const { data } = await supabase
    .from('countries')
    .select('id, slug, name, code, active')
    .eq('active', true)
    .order('sort_order', { ascending: true })
  return (data as Country[]) ?? []
}

export async function fetchProvincias(supabase: SupabaseClient, countryId: string): Promise<Provincia[]> {
  const { data } = await supabase
    .from('provincias')
    .select('id, country_id, slug, name, active, sort_order')
    .eq('country_id', countryId)
    .eq('active', true)
    .order('sort_order', { ascending: true })
  return (data as Provincia[]) ?? []
}

export async function fetchComunas(supabase: SupabaseClient, provinciaId: string): Promise<Comuna[]> {
  const { data } = await supabase
    .from('comunas')
    .select('id, provincia_id, slug, name, active, sort_order')
    .eq('provincia_id', provinciaId)
    .eq('active', true)
    .order('sort_order', { ascending: true })
  return (data as Comuna[]) ?? []
}

export async function fetchBarrios(supabase: SupabaseClient, comunaId: string): Promise<Barrio[]> {
  const { data } = await supabase
    .from('barrios')
    .select('id, comuna_id, slug, name, active, sort_order')
    .eq('comuna_id', comunaId)
    .eq('active', true)
    .order('sort_order', { ascending: true })
  return (data as Barrio[]) ?? []
}
