export const TIER_LIMITS = {
  // Elite — Elite, top of the stack. 8 spots / month, accent halo + shimmer.
  elite:    { photos: 18, videos: 3, audios: 1,
             boostsPerMonth: 8, historiesPerDay: 5,
             analytics: 'completo+', pin: true,
             coverVideo: true, favorites: true,
             agenda: true, reviews: true, chatDirecto: true,
             verification: true, competitionStats: true,
             photoEditing: true },
  gold:   { photos: 15, videos: 2, audios: 1,
             boostsPerMonth: 4, historiesPerDay: 3,
             analytics: 'completo+', pin: true,
             coverVideo: true, favorites: true,
             agenda: true, reviews: true, chatDirecto: true,
             verification: true, competitionStats: true,
             photoEditing: true },
  silver:   { photos: 12, videos: 1, audios: 0,
             boostsPerMonth: 2, historiesPerDay: 2,
             analytics: 'completo', pin: true,
             coverVideo: false, favorites: true,
             agenda: false, reviews: true, chatDirecto: true,
             verification: true, competitionStats: false,
             photoEditing: true },
  bronze:   { photos: 9, videos: 0, audios: 0,
             boostsPerMonth: 1, historiesPerDay: 1,
             analytics: 'basico', pin: false,
             coverVideo: false, favorites: false,
             agenda: false, reviews: 'limitadas' as const, chatDirecto: false,
             verification: true, competitionStats: false,
             photoEditing: true },
  basic: { photos: 6,  videos: 0, audios: 0,
             boostsPerMonth: 1, historiesPerDay: 0,
             analytics: false as const, pin: false,
             coverVideo: false, favorites: false,
             agenda: false, reviews: false as const, chatDirecto: false,
             verification: false, competitionStats: false,
             photoEditing: true },
} as const

export type TierKey = keyof typeof TIER_LIMITS

export const TIER_RANK: Record<string, number> = {
  elite: 0, gold: 1, silver: 2, bronze: 3, basic: 4,
}

// Elite: Elite tier with capped supply (max active subscriptions per month).
export const ELITE_MONTHLY_QUOTA = 8
