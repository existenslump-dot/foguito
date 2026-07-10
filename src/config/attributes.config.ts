/**
 * Config-driven listing attribute system.
 *
 * This file is the SINGLE source of truth for the per-listing structured
 * attributes that the post form collects, the detail page renders, and the
 * feed filters on. Listings store these values in the `posts.attributes`
 * JSONB column keyed by `AttributeDef.key`.
 *
 * RETARGETING THE VERTICAL: change ONLY this file. Swap `LISTING_ATTRIBUTES`
 * for your own list (rates, square footage, cuisine, skills, etc.) and the
 * create/edit forms, the post-detail render, and the admin field map all
 * follow automatically — no schema migration and no component edits needed.
 *
 * The example below targets a LOCAL SERVICES / PROFESSIONAL DIRECTORY vertical
 * (plumbers, tutors, cleaners, consultants…). UI copy is Spanish to match the
 * rest of the app; comments are English.
 */

export type AttributeType = 'text' | 'number' | 'select' | 'multiselect' | 'boolean'

export interface AttributeDef {
  /** Stable key used as the JSONB property name in `posts.attributes`. */
  key: string
  /** Human label shown in forms / detail view (Spanish UI copy). */
  label: string
  /** Input/render widget to use for this attribute. */
  type: AttributeType
  /** Choices for `select` / `multiselect` types. */
  options?: string[]
  /** Section heading used to group attributes in forms and the detail view. */
  group?: string
  /** Unit suffix rendered next to numeric values (e.g. '$/h'). */
  unit?: string
  /** When true, the attribute is exposed in the feed filter UI. */
  filterable?: boolean
  /** When true, only admins can edit it; non-admins see a read-only card. */
  adminOnly?: boolean
}

/**
 * Example vertical: local services / professional directory.
 * Replace this array to retarget the marketplace to another vertical.
 */
export const LISTING_ATTRIBUTES: AttributeDef[] = [
  {
    key: 'rate',
    label: 'Tarifa',
    type: 'number',
    unit: '$/h',
    group: 'Tarifa',
    filterable: true,
  },
  {
    key: 'experience_years',
    label: 'Años de experiencia',
    type: 'number',
    group: 'Experiencia',
  },
  {
    key: 'certifications',
    label: 'Certificaciones / matrícula',
    type: 'text',
    group: 'Experiencia',
  },
  {
    key: 'service_area',
    label: 'Zona de cobertura',
    type: 'text',
    group: 'Cobertura',
  },
  {
    key: 'modality',
    label: 'Modalidad',
    type: 'multiselect',
    options: ['A domicilio', 'En local', 'Remoto'],
    group: 'Cobertura',
    filterable: true,
  },
  {
    key: 'availability',
    label: 'Disponibilidad',
    type: 'multiselect',
    options: ['Lunes a viernes', 'Fines de semana', 'Noches', '24 horas'],
    group: 'Disponibilidad',
    filterable: true,
  },
  {
    key: 'languages',
    label: 'Idiomas',
    type: 'multiselect',
    options: ['Español', 'Inglés', 'Portugués', 'Francés'],
    group: 'Idiomas',
  },
]

/** All listing attributes, in declaration order. */
export function getListingAttributes(): AttributeDef[] {
  return LISTING_ATTRIBUTES
}

/**
 * Attributes bucketed by their `group`, in first-seen group order.
 * Attributes without a `group` fall into a 'General' bucket.
 */
export function getAttributeGroups(): { group: string; attributes: AttributeDef[] }[] {
  const order: string[] = []
  const byGroup = new Map<string, AttributeDef[]>()
  for (const attr of LISTING_ATTRIBUTES) {
    const group = attr.group || 'General'
    if (!byGroup.has(group)) {
      byGroup.set(group, [])
      order.push(group)
    }
    byGroup.get(group)!.push(attr)
  }
  return order.map(group => ({ group, attributes: byGroup.get(group)! }))
}

/** Look up a single attribute definition by key. */
export function getAttributeDef(key: string): AttributeDef | undefined {
  return LISTING_ATTRIBUTES.find(attr => attr.key === key)
}
