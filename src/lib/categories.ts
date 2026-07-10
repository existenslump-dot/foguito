// EXAMPLE categories — local services / professional directory vertical.
// Replace with your vertical's taxonomy. For production, set
// `vertical.taxonomySource: 'db'` in marketplace.config.ts and manage
// categories from the `categories` table (no redeploy needed to change them).
// Keep these slugs in sync with the categories seed migration.
export const CATEGORIES = [
  { id: 'hogar-reparaciones', label: 'Hogar y Reparaciones', order: 1 },
  { id: 'clases-particulares', label: 'Clases Particulares', order: 2 },
  { id: 'belleza-bienestar', label: 'Belleza y Bienestar', order: 3 },
  { id: 'eventos-fotografia', label: 'Eventos y Fotografía', order: 4 },
  { id: 'tecnologia', label: 'Tecnología y Soporte', order: 5 },
  { id: 'salud', label: 'Salud y Cuidados', order: 6 },
] as const

// Concierge mode: `credits` field is now interpreted as USD price directly.
// Original credits-mode values were 400/200/100/50. Field name kept for
// compatibility with admin webhooks. Restore for phase 2 if needed.
export const TIERS = [
  // Elite — Elite, capped to 8 active subscriptions per month.
  { id: 'elite',    label: 'Elite',    credits: 599, order: 0 },
  { id: 'gold',   label: 'Gold',   credits: 399, order: 1 },
  { id: 'silver',   label: 'Silver',   credits: 199, order: 2 },
  { id: 'bronze',   label: 'Bronze',   credits: 99,  order: 3 },
  { id: 'basic', label: 'Basic', credits: 49,  order: 4 },
] as const

export type CategoryId = typeof CATEGORIES[number]['id']
export type TierId     = typeof TIERS[number]['id']

export const TIER_COLORS: Record<string, string> = {
  elite:    'var(--v-accent-light)',
  gold:   'var(--v-accent)',
  silver:   '#aaa',
  bronze:   '#666',
  basic: '#444',
}

export const TIER_BADGE_STYLES: Record<string, { background: string; color: string; border: string }> = {
  // Elite — accent gradient halo, brighter than Gold
  elite:    { background: 'linear-gradient(135deg, rgba(37,99,235,0.35), rgba(37, 99, 235,0.18))', color: '#93C5FD', border: '1px solid rgba(37,99,235,0.7)' },
  gold:   { background: 'rgba(37, 99, 235,0.20)',  color: 'var(--v-accent-light)', border: '1px solid rgba(37, 99, 235,0.5)'  },
  silver:   { background: 'rgba(200,200,200,0.15)', color: '#D0CEC8', border: '1px solid rgba(200,200,200,0.35)' },
  bronze:   { background: 'rgba(150,150,150,0.12)', color: '#B0AEA8', border: '1px solid rgba(150,150,150,0.30)' },
  basic: { background: 'rgba(100,100,100,0.12)', color: '#888',    border: '1px solid rgba(100,100,100,0.28)' },
}

export const TIER_ORDER   = ['elite', 'gold', 'silver', 'bronze', 'basic'] as const
export const CATEGORY_ORDER = [
  'hogar-reparaciones',
  'clases-particulares',
  'belleza-bienestar',
  'eventos-fotografia',
  'tecnologia',
  'salud',
] as const
