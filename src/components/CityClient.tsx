'use client'
import { supabase } from '@/lib/supabase/client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { CATEGORIES, TIERS } from '@/lib/categories'
import { TIER_RANK } from '@/lib/tiers'
import PostCard from '@/components/PostCard'
import { useLang } from '@/contexts/LanguageContext'
import { t, tOption } from '@/lib/i18n'
import { getAttributeDef } from '@/config/attributes.config'
import { useGeoCascade } from '@/hooks/useGeoCascade'
import type { FeedPost } from '@/lib/types/post'
import CityStoryTray from './CityStoryTray'
import { STORIES_ENABLED, COUNTRY_SLUG, DISPLAY_LOCALE } from '@/config/marketplace.config'

const MAX_CLP = 2_000_000

// The two multiselect feed filters are driven by config-driven, filterable
// listing attributes (src/config/attributes.config.ts). Retargeting the
// vertical swaps these automatically. Option lists come from each attribute's
// `options`; matching reads the post's `attributes[key]` array.
const FILTER_A_KEY = 'modality'
const FILTER_B_KEY = 'availability'
const filterAOptions = getAttributeDef(FILTER_A_KEY)?.options ?? []
const filterBOptions = getAttributeDef(FILTER_B_KEY)?.options ?? []

function postAttrArray(p: { attributes?: Record<string, unknown> | null }, key: string): string[] {
  const v = p.attributes?.[key]
  return Array.isArray(v) ? (v as string[]) : []
}

const CURR_MAX: Record<string, number> = { CLP: 2_000_000, USD: 2100, EUR: 1900, ARS: 2_400_000 }

function roundDisplay(val: number, currency: string): number {
  if (currency === 'CLP' || currency === 'ARS') return Math.round(val / 10000) * 10000
  return Math.round(val / 50) * 50
}

function clpToDisplay(clp: number, currency: string): number {
  if (currency === 'USD') return roundDisplay(clp / 950, currency)
  if (currency === 'EUR') return roundDisplay(clp / 1050, currency)
  if (currency === 'ARS') return roundDisplay(clp * 1.2, currency)
  return roundDisplay(clp, currency)
}

const CURR_SYMBOL: Record<string, string> = { CLP: '$', USD: 'USD ', EUR: '€', ARS: 'ARS ' }

interface Props {
  /** Feed cards require price + image_urls + title — narrower than `Post`. */
  posts: FeedPost[]
  cityParam: string
  countryId: string
}

export default function CityClient({ posts, cityParam, countryId }: Props) {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const { lang }     = useLang()

  const [dynCategories, setDynCategories] = useState(CATEGORIES as readonly { id: string; label: string; order: number }[])
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set())
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [catsRes, hiddenRes] = await Promise.all([
          supabase.from('categories').select('name, slug').eq('active', true).order('name'),
          supabase.from('city_category_settings').select('category_slug').eq('city_slug', cityParam).eq('visible', false),
        ])
        if (cancelled) return
        if (catsRes.error) {
          console.error('[city-feed] categories fetch failed', catsRes.error)
        } else if (catsRes.data && catsRes.data.length > 0) {
          const mapped = catsRes.data.map((c, i) => ({ id: c.slug, label: c.name, order: i + 1 }))
          setDynCategories(mapped)
        }
        if (hiddenRes.error) {
          console.error('[city-feed] city_category_settings fetch failed', hiddenRes.error)
        } else if (hiddenRes.data) {
          setHiddenCats(new Set(hiddenRes.data.map(d => d.category_slug)))
        }
      } catch (e) {
        if (!cancelled) console.error('[city-feed] filter bootstrap threw', e)
      }
    })()
    return () => { cancelled = true }
  }, [cityParam])

  const [searchFocused,   setSearchFocused]   = useState(false)
  const searchBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [search,          setSearch]          = useState(searchParams.get('q')   || '')
  const [filterCat,       setFilterCat]       = useState(searchParams.get('cat') || '')
  const [filterTier,      setFilterTier]      = useState(searchParams.get('tier') || '')
  const [filterProvinciaSlug, setFilterProvinciaSlug] = useState(searchParams.get('provincia') || '')
  const [filterComunaSlug,    setFilterComunaSlug]    = useState(searchParams.get('comuna') || '')
  const geoFilter = useGeoCascade({ countrySlug: COUNTRY_SLUG })
  const [filterCurrency,  setFilterCurrency]  = useState('USD')
  const [filterMinCLP,    setFilterMinCLP]    = useState(0)
  const [filterMaxCLP,    setFilterMaxCLP]    = useState(MAX_CLP)

  useEffect(() => {
    setFilterMinCLP(0)
    setFilterMaxCLP(MAX_CLP)
  }, [filterCurrency])
  const [filterServicios, setFilterServicios] = useState<string[]>(
    searchParams.get('sv')?.split(',').filter(Boolean) || []
  )
  const [filterAtributos, setFilterAtributos] = useState<string[]>(
    searchParams.get('at')?.split(',').filter(Boolean) || []
  )
  const [showSvDropdown, setShowSvDropdown] = useState(false)
  const [showAtDropdown, setShowAtDropdown] = useState(false)
  const [filterOpen,     setFilterOpen]     = useState(false)

  const availableCats = useMemo(
    () => new Set(posts.map(p => p.category).filter(Boolean) as string[]),
    [posts],
  )
  const availableTiers = useMemo(
    () => new Set(posts.map(p => p.tier).filter(Boolean) as string[]),
    [posts],
  )

  const [qExperiencias, setQExperiencias] = useState(searchParams.get('qx')  === '1')
  const [qPromocion,    setQPromocion]    = useState(searchParams.get('qpr') === '1')
  const [qConVideo,     setQConVideo]     = useState(searchParams.get('qv')  === '1')

  const [reviewedPostIds, setReviewedPostIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('reviews')
        .select('post_id')
        .eq('approved', true)
      if (cancelled || !data) return
      setReviewedPostIds(new Set(data.map(r => r.post_id).filter(Boolean) as string[]))
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.v-dropdown-wrap')) {
        setShowSvDropdown(false)
        setShowAtDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [])

  const urlSyncArmed = useRef(false)
  useEffect(() => {
    if (!urlSyncArmed.current) { urlSyncArmed.current = true; return }
    const timer = setTimeout(() => {
      const CONTROLLED = ['q', 'cat', 'tier', 'provincia', 'comuna', 'min', 'max', 'sv', 'at', 'qx', 'qcv', 'qpr', 'qv'] as const
      const params = new URLSearchParams(window.location.search)
      for (const k of CONTROLLED) params.delete(k)
      if (search)         params.set('q',   search)
      if (filterCat)      params.set('cat', filterCat)
      if (filterTier)     params.set('tier',filterTier)
      if (filterProvinciaSlug) params.set('provincia', filterProvinciaSlug)
      if (filterComunaSlug)    params.set('comuna',    filterComunaSlug)
      if (filterMinCLP > 0)          params.set('min', String(filterMinCLP))
      if (filterMaxCLP < MAX_CLP)    params.set('max', String(filterMaxCLP))
      if (filterServicios.length) params.set('sv', filterServicios.join(','))
      if (filterAtributos.length) params.set('at', filterAtributos.join(','))
      if (qExperiencias) params.set('qx',  '1')
      if (qPromocion)    params.set('qpr', '1')
      if (qConVideo)     params.set('qv',  '1')
      const qs = params.toString()
      // Use the current pathname instead of `/${cityParam}` so the sync
      // preserves any deeper geo segments (provincia/comuna/barrio) and
      // SEO-landing slugs.
      const targetUrl = qs ? `${pathname}?${qs}` : pathname
      const currentUrl = window.location.pathname + window.location.search
      if (targetUrl === currentUrl) return // skip noop replace — anti-loop guard
      router.replace(targetUrl, { scroll: false })
    }, 300)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterCat, filterTier, filterProvinciaSlug, filterComunaSlug, filterMinCLP, filterMaxCLP, filterServicios, filterAtributos, qExperiencias, qPromocion, qConVideo])

  const clearFilters = () => {
    setSearch(''); setFilterCat(''); setFilterTier('')
    setFilterProvinciaSlug(''); setFilterComunaSlug('')
    setFilterMinCLP(0); setFilterMaxCLP(MAX_CLP)
    setFilterServicios([]); setFilterAtributos([])
    setQExperiencias(false); setQPromocion(false); setQConVideo(false)
  }

  const hasActiveFilters = !!(search || filterCat || filterTier || filterProvinciaSlug || filterComunaSlug || filterMinCLP > 0 || filterMaxCLP < MAX_CLP || filterServicios.length || filterAtributos.length || qExperiencias || qPromocion || qConVideo)

  const filterProvincia = geoFilter.provincias.find(p => p.slug === filterProvinciaSlug)
  useEffect(() => {
    geoFilter.setProvinciaId(filterProvincia?.id ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterProvincia?.id])
  const filterComuna = geoFilter.comunas.find(c => c.slug === filterComunaSlug)

  useEffect(() => {
    if (!filterProvinciaSlug) return
    if (filterComunaSlug && !geoFilter.comunas.some(c => c.slug === filterComunaSlug)) {
      setFilterComunaSlug('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterProvinciaSlug, geoFilter.comunas.length])

  const filtered = posts.filter(p => {
    if (search) {
      const pCountry = Array.isArray(p.countries) ? p.countries[0] : p.countries
      const hay = `${p.title} ${p.description || ''} ${p.localidad || ''} ${pCountry?.name || ''} ${postAttrArray(p, FILTER_A_KEY).join(' ')} ${postAttrArray(p, FILTER_B_KEY).join(' ')}`.toLowerCase()
      if (!hay.includes(search.toLowerCase())) return false
    }
    // Geo filters — match against FK IDs (precise) with legacy localidad-text
    // fallback for posts that predate the backfill and still have NULL FKs.
    if (filterProvincia) {
      const match = p.provincia_id
        ? p.provincia_id === filterProvincia.id
        : (p.localidad || '').toLowerCase().includes(filterProvincia.name.toLowerCase())
      if (!match) return false
    }
    if (filterComuna) {
      const match = p.comuna_id
        ? p.comuna_id === filterComuna.id
        : (p.localidad || '').toLowerCase().includes(filterComuna.name.toLowerCase())
      if (!match) return false
    }
    if (filterCat  && p.category !== filterCat)  return false
    if (filterTier && p.tier     !== filterTier)  return false
    if (filterMinCLP > 0 && p.price < filterMinCLP) return false
    if (filterMaxCLP < MAX_CLP && p.price > filterMaxCLP) return false
    if (filterServicios.length && !filterServicios.every(s => postAttrArray(p, FILTER_A_KEY).includes(s))) return false
    if (filterAtributos.length && !filterAtributos.every(a => postAttrArray(p, FILTER_B_KEY).includes(a))) return false
    if (qExperiencias && !reviewedPostIds.has(p.id)) return false
    if (qPromocion    && !(p.is_promoted && p.promo_price)) return false
    if (qConVideo     && !(p.video_urls && p.video_urls.length > 0)) return false
    return true
  })

  // Deterministic daily shuffle: fair round-robin across Elite (and other)
  // posts within the same "bucket" so no-one is permanently first. The seed
  // resets once per day so order is stable within a session but rotates
  // across days. Uses a tiny xorshift32 PRNG keyed on post.id + today's date.
  const shuffleSeed = useMemo(() => {
    const d = new Date()
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
  }, [])
  const dailyHash = (id: string) => {
    let h = 2166136261
    const s = `${shuffleSeed}:${id}`
    for (let i = 0; i < s.length; i++) {
      h = (h ^ s.charCodeAt(i)) >>> 0
      h = Math.imul(h, 16777619) >>> 0
    }
    return h
  }

  const grouped = dynCategories
    .filter(cat => !hiddenCats.has(cat.id))
    .map(cat => ({
      cat,
      posts: filtered
        .filter(p => p.category === cat.id)
        .sort((a, b) => {
          const now = Date.now()
          // 1. Pinned Gold first
          const aPin = !!a.is_pinned && a.tier === 'gold' && !!a.pin_ends_at && new Date(a.pin_ends_at).getTime() > now
          const bPin = !!b.is_pinned && b.tier === 'gold' && !!b.pin_ends_at && new Date(b.pin_ends_at).getTime() > now
          if (aPin && !bPin) return -1
          if (!aPin && bPin) return 1
          // 2. Boosted posts by tier
          const aBoosted = !!a.is_boosted && !!a.boost_ends_at && new Date(a.boost_ends_at).getTime() > now
          const bBoosted = !!b.is_boosted && !!b.boost_ends_at && new Date(b.boost_ends_at).getTime() > now
          if (aBoosted && !bBoosted) return -1
          if (!aBoosted && bBoosted) return 1
          if (aBoosted && bBoosted) return (TIER_RANK[a.tier ?? ''] ?? 99) - (TIER_RANK[b.tier ?? ''] ?? 99)
          // 3. By tier rank
          const tierDiff = (TIER_RANK[a.tier ?? ''] ?? 99) - (TIER_RANK[b.tier ?? ''] ?? 99)
          if (tierDiff !== 0) return tierDiff
          // 4. Within the same tier: daily round-robin so everyone takes turns
          //    at the top (applied to Elite/Gold; lower tiers still fall back
          //    to newest-first to favour fresh uploads).
          if (a.tier === 'elite' || a.tier === 'gold') {
            return dailyHash(a.id) - dailyHash(b.id)
          }
          return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
        }),
    }))
    .filter(g => g.posts.length > 0)

  const groupedIds = new Set(grouped.flatMap(g => g.posts.map(p => p.id)))
  const uncategorized = filtered.filter(p =>
    !groupedIds.has(p.id) && !(p.category && hiddenCats.has(p.category)),
  )

  return (
    <>
      <style>{`
        .v-filter-bar{
          display:flex;flex-direction:column;gap:8px;width:100%;
        }

        .v-filter-grid{
          display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;
        }

        .v-filter-input{
          background:var(--v-bg-elevated);border:1px solid rgba(var(--brand-primary-rgb),0.15);
          color:var(--v-text-primary);font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:400;
          padding:0 40px 0 40px;border-radius:6px;outline:none;
          transition:border-color .3s ease;height:52px;letter-spacing:.04em;width:100%;
        }
        .v-filter-input::placeholder{color:var(--v-text-tertiary)}
        .v-filter-input:focus{border-color:rgba(var(--brand-primary-rgb),0.35)}

        /* Search wrapper */
        .v-search-wrap{position:relative;flex:1;min-width:0;}
        .v-search-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--v-text-tertiary);}
        .v-search-clear{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:transparent;border:none;cursor:pointer;color:var(--v-text-tertiary);font-size:14px;padding:4px;display:flex;align-items:center;transition:color .3s ease;}
        .v-search-clear:hover{color:var(--v-accent-strong)}

        /* Suggestions dropdown */
        .v-search-dropdown{
          position:absolute;top:calc(100% + 4px);left:0;right:0;
          background:var(--v-bg-card);border:1px solid rgba(var(--brand-primary-rgb),0.2);
          border-radius:6px;z-index:100;overflow:hidden;
        }
        .v-search-dropdown-label{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:7px;font-weight:400;
          letter-spacing:.2em;text-transform:uppercase;color:var(--v-accent-strong);
          padding:10px 16px 6px;
        }
        .v-search-suggestion{
          display:flex;align-items:center;gap:10px;
          padding:10px 16px;cursor:pointer;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:9px;font-weight:400;
          letter-spacing:.04em;color:var(--v-text-secondary);
          transition:background .2s ease, color .2s ease;
        }
        .v-search-suggestion:hover{background:var(--v-bg-hover);color:var(--v-accent-strong)}

        .v-filter-select{
          background:var(--v-bg-elevated);border:1px solid rgba(var(--brand-primary-rgb),0.15);
          color:var(--v-text-secondary);font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:400;
          letter-spacing:.04em;
          padding:8px 12px;border-radius:6px;outline:none;cursor:pointer;
          appearance:none;flex-shrink:0;transition:border-color .3s ease;
          text-align:center;text-align-last:center;
        }
        .v-filter-select:focus{border-color:rgba(var(--brand-primary-rgb),0.35)}

        .v-filter-pill{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:400;
          letter-spacing:.04em;
          padding:8px 14px;border-radius:6px;border:1px solid rgba(var(--brand-primary-rgb),0.15);
          background:var(--v-bg-elevated);color:var(--v-text-secondary);cursor:pointer;white-space:nowrap;flex-shrink:0;
          transition:color .3s ease,border-color .3s ease;
          text-align:center;
        }
        .v-filter-pill:hover{color:var(--v-text-primary);border-color:var(--v-border)}
        .v-filter-pill.active{color:var(--v-accent-strong);border-color:rgba(var(--brand-primary-rgb),0.4);background:rgba(var(--brand-primary-rgb),0.05)}

        .v-dropdown-wrap{position:relative;flex-shrink:0}
        .v-dropdown{
          position:absolute;top:calc(100% + 6px);right:0;z-index:500;
          background:var(--v-bg-card);border:1px solid rgba(var(--brand-primary-rgb),0.12);
          border-radius:6px;padding:10px;min-width:220px;
          display:flex;flex-wrap:wrap;gap:8px;
        }
        .v-dropdown-chip{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:9px;font-weight:400;
          letter-spacing:.18em;text-transform:uppercase;
          padding:5px 10px;border-radius:6px;cursor:pointer;
          border:1px solid rgba(var(--brand-primary-rgb),0.15);background:transparent;color:var(--v-text-secondary);
          transition:all .2s ease;white-space:nowrap;
        }
        .v-dropdown-chip:hover{color:var(--v-text-primary);border-color:var(--v-border)}
        .v-dropdown-chip.selected{color:var(--v-accent-strong);border-color:rgba(var(--brand-primary-rgb),0.4);background:rgba(var(--brand-primary-rgb),0.06)}

        /* Sticky filter bar — desktop only.
           top:0 because on desktop the UserHeader is sm:relative (leaves the
           sticky flow → scrolls with the page). With top:84px the filter
           floated 84px down from a header-less viewport → it looked like it
           "dropped with the scroll". With top:0 the filter lands at the top
           edge exactly when the header finishes leaving the viewport. */
        .v-filter-sticky-bar{
          position:sticky;top:0;z-index:40;
        }
        @media(max-width:767px){
          .v-filter-sticky-bar{position:static;top:auto}
        }

        /* ── Hero (video bg + heading + search + pills) ───────────────── */
        .v-hero{position:relative;width:100%;overflow:hidden;}
        /* Desktop: cap the hero at 900px and center it. The natural
           object-cover zoom of a 720x1280 portrait clip drops from ~1.76×
           (at full-bleed 1265px) to ~1.25×, which is what makes the band
           legible instead of looking like an extreme close-up. The dark
           page bg (var(--v-bg-base)) shows through on the sides and reads as a
           deliberate matte rather than empty space. */
        @media(min-width:768px){.v-hero{max-width:900px;margin-left:auto;margin-right:auto;}}
        /* Asset-free hero backdrop — a CSS gradient panel built from the
           design tokens (accent glow over the elevated/base surface). No
           media download, and it adapts to light/dark themes via the vars. */
        .v-hero-bg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;background:radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--v-accent) 22%, transparent) 0%, transparent 55%), linear-gradient(180deg, var(--v-bg-elevated, var(--v-bg-base)) 0%, var(--v-bg-base) 100%);}
        .v-hero-overlay{
          position:absolute;inset:0;pointer-events:none;
          background:linear-gradient(180deg,rgba(var(--v-bg-base-rgb),0.0) 0%,rgba(var(--v-bg-base-rgb),0.4) 70%,rgba(var(--v-bg-base-rgb),0.92) 100%);
        }
        .v-hero-content{
          position:relative;z-index:2;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          text-align:center;
          padding:64px 16px 48px;max-width:820px;margin:0 auto;
          gap:28px;
        }
        @media(min-width:768px){.v-hero-content{padding:96px 32px 64px;gap:32px;}}

        .v-hero-heading{
          font-family:'Cormorant Garamond','Georgia',serif;
          font-weight:400;font-size:clamp(30px,5vw,48px);line-height:1.1;
          letter-spacing:-.01em;color:var(--v-text-primary);margin:0;
        }
        .v-hero-heading-accent{
          color:var(--v-accent);font-weight:600;font-style:italic;
        }

        .v-hero-search-wrap{position:relative;width:100%;max-width:640px;}
        .v-hero-input{
          width:100%;box-sizing:border-box;
          background:var(--v-bg-card);border:1px solid rgba(var(--brand-primary-rgb),0.18);
          border-radius:999px;padding:13px 56px 13px 44px;
          font-family:'Switzer','Inter','Helvetica_Neue',Arial,sans-serif;
          font-size:13px;font-weight:400;letter-spacing:.005em;
          color:var(--v-text-primary);outline:none;backdrop-filter:blur(8px);
          box-shadow:var(--v-shadow-card);
          transition:border-color .3s ease, background .3s ease;
        }
        .v-hero-input::placeholder{color:var(--v-text-tertiary)}
        .v-hero-input:focus{border-color:rgba(var(--brand-primary-rgb),0.32);background:var(--v-bg-card);}
        .v-hero-search-wrap .v-search-icon{position:absolute;left:18px;top:50%;transform:translateY(-50%);color:var(--v-accent);}
        .v-hero-search-wrap .v-search-clear{position:absolute;right:14px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:var(--v-text-tertiary);cursor:pointer;font-size:14px;}
        .v-hero-search-wrap .v-search-dropdown{
          position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:3;
          background:var(--v-bg-card);border:1px solid rgba(var(--brand-primary-rgb),0.25);
          border-radius:6px;padding:8px;backdrop-filter:blur(12px);
        }

        .v-hero-pills{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;max-width:720px;}
        .v-hero-pill{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:11px;font-weight:500;letter-spacing:.04em;
          padding:7px 13px 6px;border-radius:999px;cursor:pointer;
          background:var(--v-bg-card);border:1px solid rgba(var(--brand-primary-rgb),0.18);
          color:var(--v-text-secondary);
          transition:background .2s ease,border-color .2s ease,color .2s ease;
          display:inline-flex;align-items:center;gap:6px;
          white-space:nowrap;
        }
        .v-hero-pill-icon{width:10px;height:10px;flex-shrink:0;}
        .v-hero-pill:hover{
          color:var(--v-accent-strong);
          background:rgba(var(--brand-primary-rgb),0.08);
          border-color:rgba(var(--brand-primary-rgb),0.32);
        }
        .v-hero-pill.active{
          background:rgba(var(--brand-primary-rgb),0.08);
          border-color:rgba(var(--brand-primary-rgb),0.32);
          color:var(--v-accent-strong);
        }

        /* Price range row */
        .v-price-range-row{
          width:100%;
        }
        @media(min-width:768px){
          .v-price-range-row{
            max-width:360px;
          }
        }

        /* Range slider */
        .v-range-input{
          -webkit-appearance:none;appearance:none;
          height:100%;margin:0;background:transparent;outline:none;
          cursor:pointer;position:absolute;width:100%;
        }
        .v-range-input::-webkit-slider-thumb{
          -webkit-appearance:none;width:0;height:0;pointer-events:auto;
        }
        .v-range-input::-moz-range-thumb{
          width:0;height:0;border:none;background:transparent;pointer-events:auto;
        }

        /* Post cards */
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        .v-fadein{opacity:0;animation:fadeUp .9s cubic-bezier(.22,1,.36,1) forwards}

        /* ═══════════════════════════════════════
           CARD DESIGN — Landscape
           Overlay-first design: 3:4 photo with name/age/verif/loc in a
           bottom-left overlay, tier pill top-right, green promo top-left,
           white video tag bottom-right, info row with current + struck-through
           price BELOW the photo.
        ═══════════════════════════════════════ */
        .v-card {
          display: block;
          background: #100e0a;
          border: 1px solid rgba(var(--brand-primary-rgb),0.08);
          border-radius: 10px;
          overflow: hidden;
          position: relative;
          text-decoration: none;
          transition: border-color .35s ease, transform .35s ease;
        }
        .v-card:hover { border-color: rgba(var(--brand-primary-rgb),0.32); transform: translateY(-2px); }
        .v-card:hover .v-card-media { transform: scale(1.05); }

        /* Elite — accent halo + shimmer (same vibe as the legacy card) */
        .v-card.v-elite {
          border: 1px solid rgba(var(--brand-primary-rgb),0.55);
          box-shadow:
            0 0 0 1px rgba(var(--brand-primary-rgb),0.25),
            0 0 24px rgba(var(--brand-primary-rgb),0.18),
            0 0 60px rgba(var(--brand-primary-rgb),0.10);
        }
        .v-card.v-elite:hover {
          border-color: rgba(var(--brand-primary-rgb),0.85);
          box-shadow:
            0 0 0 1px rgba(var(--brand-primary-rgb),0.45),
            0 0 32px rgba(var(--brand-primary-rgb),0.28),
            0 0 80px rgba(var(--brand-primary-rgb),0.16);
        }
        .v-card.v-elite::before {
          content: '';
          position: absolute; inset: 0; z-index: 5;
          pointer-events: none;
          background: linear-gradient(120deg,
            transparent 30%,
            rgba(var(--brand-primary-rgb),0.14) 48%,
            rgba(var(--brand-primary-rgb),0.26) 50%,
            rgba(var(--brand-primary-rgb),0.14) 52%,
            transparent 70%);
          background-size: 220% 100%; background-position: 200% 0;
          animation: eliteShimmer 9s ease-in-out infinite;
          mix-blend-mode: screen;
        }

        .v-card-ph {
          position: relative;
          aspect-ratio: 1/1.618;
          background: var(--v-bg-elevated) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20'/%3E%3C/svg%3E") center/64px no-repeat;
          overflow: hidden;
        }
        .v-card-media {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
          object-fit: cover;
          transition: transform 1.2s cubic-bezier(.22,1,.36,1);
        }
        .v-card-placeholder {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 8px; font-weight: 400; letter-spacing: .2em;
          text-transform: uppercase; color: var(--v-text-tertiary);
        }
        .v-card-gradient {
          position: absolute; inset: 0;
          pointer-events: none;
          background: linear-gradient(180deg,
            rgba(8,8,8,0.45) 0%,
            transparent 22%,
            transparent 50%,
            rgba(8,8,8,0.85) 100%);
        }

        /* Top overlay: promo verde izq + tier pill der */
        .v-card-ovl-top {
          position: absolute; top: 8px; left: 8px; right: 8px;
          z-index: 2;
          display: flex; justify-content: space-between; align-items: flex-start;
          gap: 6px;
        }
        .v-card-promo {
          background: rgba(106,176,106,0.18);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          border: 1px solid rgba(106,176,106,0.4);
          color: #6ab06a;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 8.5px; font-weight: 600;
          letter-spacing: 0.16em; text-transform: uppercase;
          padding: 3px 7px 2px;
          border-radius: 3px;
        }
        .v-card-tier {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500;
          font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase;
          padding: 3px 7px 2px;
          border-radius: 3px;
          line-height: 1.2;
          white-space: nowrap;
        }
        .v-card-tier-gold { background: var(--v-accent); color: var(--v-text-inverse); }
        .v-card-tier-silver {
          background: rgba(8,8,8,0.6);
          border: 1px solid rgba(var(--brand-primary-rgb),0.32);
          color: var(--v-accent);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }
        .v-card-tier-bronze {
          background: rgba(8,8,8,0.6);
          border: 1px solid rgba(255,255,255,0.15);
          color: #E2E8F0;
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }
        .v-card-tier-elite {
          background: linear-gradient(135deg,var(--v-accent-light),var(--v-accent));
          color: var(--v-text-inverse);
          box-shadow: 0 0 12px rgba(var(--brand-primary-rgb),0.5);
          font-weight: 600;
        }

        /* White video chip, bottom-right */
        .v-card-video {
          position: absolute;
          bottom: 8px; right: 8px;
          z-index: 2;
          background: rgba(8,8,8,0.6);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          color: #FFFFFF;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 9px; font-weight: 500;
          letter-spacing: 0.1em; text-transform: uppercase;
          padding: 3px 7px;
          border-radius: 3px;
          display: inline-flex; align-items: center; gap: 4px;
        }
        .v-card-video svg { width: 8px; height: 8px; }

        /* Bottom overlay: name row + location */
        .v-card-ovl-bottom {
          position: absolute;
          bottom: 8px; left: 10px; right: 10px;
          z-index: 2;
        }
        .v-card-nm-row {
          display: flex; align-items: center; gap: 6px;
          flex-wrap: wrap;
        }
        .v-card-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .v-card-dot.on {
          background: #6ab06a;
          box-shadow: 0 0 0 2px rgba(106,176,106,0.22);
        }
        .v-card-dot.off {
          background: rgba(255,255,255,0.35);
        }
        .v-card-nm {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500;
          font-size: 18px;
          color: #fff;
          line-height: 1.1;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        }
        .v-card-age {
          color: rgba(255,255,255,0.7);
          font-size: 12px;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-weight: 400;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        }
        .v-card-verif {
          display: inline-flex; align-items: center;
          color: var(--v-accent);
        }
        .v-card-loc {
          display: inline-block;
          margin-top: 6px;
          background: rgba(0,0,0,0.55);
          border: 1px solid rgba(var(--brand-primary-rgb),0.4);
          color: #fff;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 9px;
          font-weight: 400;
          letter-spacing: .02em;
          padding: 3px 8px;
          border-radius: 6px;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          box-sizing: border-box;
        }

        /* Price — bottom-left overlay, below the name. White + text-shadow
           for legibility over the photo (same pattern as .v-card-nm). */
        .v-card-px-wrap {
          display: flex; align-items: baseline; gap: 6px;
          flex-wrap: wrap; row-gap: 2px;
          margin-top: 3px;
        }
        .v-card-px {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 600;
          font-size: 17px;
          color: #fff;
          text-shadow: 0 1px 4px rgba(0,0,0,0.85);
        }
        .v-card-px-old {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10px;
          color: rgba(255,255,255,0.55);
          text-decoration: line-through;
          text-shadow: 0 1px 3px rgba(0,0,0,0.85);
        }
        .v-card-px-days {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 8.5px;
          font-weight: 500;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.7);
          text-shadow: 0 1px 3px rgba(0,0,0,0.85);
        }

        @media(max-width:639px){
          .v-card-nm{font-size:15px}
          .v-card-age{font-size:11px}
          .v-card-loc{font-size:8px;padding:2px 6px;letter-spacing:.02em}
          .v-card-px{font-size:16px}
          .v-card-tier{font-size:8px;padding:2px 6px}
          .v-card-promo{font-size:7.5px;padding:2px 6px}
          .v-card-video{font-size:8px;padding:2px 6px}
        }


        .v-post-card{
          position:relative;aspect-ratio:1/1.618;border-radius:6px;overflow:hidden;
          /* Neutral "no image" placeholder shows while the Cloudinary cover
             image is resolving — a subtle photo glyph on the elevated surface.
             Image (fill) covers it once loaded. */
          background:var(--v-bg-elevated) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20'/%3E%3C/svg%3E") center/64px no-repeat;
          border:1px solid rgba(var(--brand-primary-rgb),0.08);
          transition:border-color .5s ease;display:block;text-decoration:none;
        }
        .v-post-card:hover{border-color:rgba(var(--brand-primary-rgb),0.3)}
        .v-post-card:hover .v-post-img{transform:scale(1.08)}
        .v-post-card:hover .v-post-title{color:var(--v-accent)}
        .v-post-card:hover .v-post-info{transform:translateY(0)}

        /* ── Elite Elite — accent halo + shimmer ── */
        .v-post-card.v-elite{
          border:1px solid rgba(var(--brand-primary-rgb),0.55);
          box-shadow:
            0 0 0 1px rgba(var(--brand-primary-rgb),0.25),
            0 0 24px rgba(var(--brand-primary-rgb),0.18),
            0 0 60px rgba(var(--brand-primary-rgb),0.10);
        }
        .v-post-card.v-elite:hover{
          border-color:rgba(var(--brand-primary-rgb),0.85);
          box-shadow:
            0 0 0 1px rgba(var(--brand-primary-rgb),0.45),
            0 0 32px rgba(var(--brand-primary-rgb),0.28),
            0 0 80px rgba(var(--brand-primary-rgb),0.16);
        }
        .v-post-card.v-elite::before{
          content:'';position:absolute;inset:0;z-index:3;pointer-events:none;
          background:linear-gradient(120deg,
            transparent 30%,
            rgba(var(--brand-primary-rgb),0.14) 48%,
            rgba(var(--brand-primary-rgb),0.26) 50%,
            rgba(var(--brand-primary-rgb),0.14) 52%,
            transparent 70%);
          background-size:220% 100%;background-position:200% 0;
          /* Slower shimmer per request — 4.5s → 9s. */
          animation:eliteShimmer 9s ease-in-out infinite;
          mix-blend-mode:screen;
        }
        @keyframes eliteShimmer{
          0%,100%{background-position:200% 0;opacity:.5;}
          50%    {background-position:-50% 0;opacity:.9;}
        }
        /* Elite — accent gradient text pill, same footprint as .v-tier-badge
           (top-right, 9px font, 3px 8px padding). */
        .v-elite-badge{
          position:absolute;top:10px;right:10px;z-index:4;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:9px;font-weight:600;
          letter-spacing:.18em;text-transform:uppercase;
          color:var(--v-bg-base);
          background:linear-gradient(135deg,var(--v-accent-light),var(--v-accent));
          padding:3px 8px;border-radius:6px;
          box-shadow:0 0 12px rgba(var(--brand-primary-rgb),0.5);
        }
        @media(max-width:639px){
          .v-elite-badge{font-size:7px!important;padding:2px 6px!important;top:8px;right:8px;}
        }

        .v-post-img{
          position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
          transition:transform 1.5s cubic-bezier(.22,1,.36,1);
        }
        .v-post-gradient{
          position:absolute;inset:0;
          /* Bottom stop is fully opaque (was 0.95) so light/skin-tone
             pixels at the very bottom of the image don't bleed through
             the 5% transparency under the price label. Reported on /argentina
             where Freyja's bottom edge showed a visible colored strip.  */
          background:linear-gradient(to top,rgba(8,8,8,1) 0%,rgba(8,8,8,0.3) 50%,transparent 100%);
        }
        .v-post-info{
          position:absolute;bottom:0;left:0;right:0;padding:16px;
          transform:translateY(4px);transition:transform .5s ease;
        }
        .v-post-title{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif !important;
          font-size:clamp(15px,1.9vw,19px) !important;font-weight:500;
          color:#FFFFFF !important;letter-spacing:-.005em;line-height:1.2;
          margin-bottom:6px;transition:color .4s ease;
          text-shadow:0 1px 4px rgba(0,0,0,0.8);
          /* Allow up to 2 lines so 'Felicitas (29) ✓' won't crop on narrow phones. */
          display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
          overflow:hidden;
        }
        .v-post-title-row{
          display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;
          row-gap:0;
        }
        .v-post-name{
          min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          flex:0 1 auto;
        }
        .v-post-age{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:clamp(12px,1.4vw,15px);font-weight:400;
          color:rgba(255,255,255,0.6);letter-spacing:.01em;flex:0 0 auto;
        }
        .v-post-verified{
          width:1em;height:1em;object-fit:contain;flex:0 0 auto;
          align-self:center;transform:translateY(0.05em);
        }
        .v-location-badge{
          display:inline-block;
          background:rgba(0,0,0,0.55);
          border:1px solid rgba(var(--brand-primary-rgb),0.4);
          color:#fff !important;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:9px !important;font-weight:400;
          letter-spacing:.18em;text-transform:uppercase;
          padding:3px 8px !important;border-radius:6px;
          max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box;
        }
        .v-post-price{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:clamp(16px,2vw,20px) !important;font-weight:400;color:#FFFFFF !important;
        }
        .v-audio-badge{
          display:inline-flex;align-items:center;gap:4px;
          border:1px solid rgba(var(--brand-primary-rgb),0.2);border-radius:6px;
          padding:3px 8px;font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:6px;font-weight:400;
          letter-spacing:.18em;text-transform:uppercase;color:var(--v-accent);
          background:rgba(8,8,8,0.6);backdrop-filter:blur(4px);
        }
        .v-tier-badge{
          position:absolute;top:10px;right:10px;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:9px;font-weight:400;
          letter-spacing:.18em;text-transform:uppercase;
          padding:3px 8px;border-radius:6px;
          background:rgba(8,8,8,0.6);backdrop-filter:blur(4px);color:var(--v-accent);border:1px solid rgba(var(--brand-primary-rgb),0.4);
        }
        /* Promo badge — same geometry as .v-tier-badge (font-size, padding,
           letter-spacing, border-radius) so PROMO and GOLD/SILVER/BRONZE
           look like a set. Kept on the LEFT with a green palette so the two
           pill types never overlap on a card that has both. */
        .v-promo-badge{
          position:absolute;top:10px;left:10px;z-index:2;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:9px;font-weight:400;
          letter-spacing:.18em;text-transform:uppercase;
          padding:3px 8px;border-radius:6px;
          background:rgba(8,8,8,0.6);backdrop-filter:blur(4px);color:#80e080;border:1px solid rgba(128,224,128,0.45);
        }
        .v-cat-header{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:clamp(22px,3vw,30px);font-weight:400;
          color:var(--v-text-primary);letter-spacing:-.01em;
        }

        /* Filter toggle button — landscape design v28-05: pill accent (vs
           outline 6px legacy). Match mockup: bg accent-soft, border accent,
           font Switzer 11.5px uppercase con tracking .06em + chevron. */
        .v-filter-toggle-row{display:flex;align-items:center;gap:8px;}
        .v-filter-toggle-btn{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:11.5px;font-weight:500;
          letter-spacing:.06em;text-transform:uppercase;
          background:rgba(var(--brand-primary-rgb),0.08);
          border:1px solid rgba(var(--brand-primary-rgb),0.32);
          color:var(--v-accent-strong);
          padding:9px 16px 8px;border-radius:999px;cursor:pointer;
          transition:color .25s ease,border-color .25s ease,background .25s ease;
          display:inline-flex;align-items:center;gap:7px;
          flex-shrink:0;white-space:nowrap;
        }
        .v-filter-toggle-btn:hover{
          border-color:rgba(var(--brand-primary-rgb),0.55);
          background:rgba(var(--brand-primary-rgb),0.14);
        }
        .v-filter-toggle-btn.active{
          color:var(--v-accent);
          border-color:rgba(var(--brand-primary-rgb),0.55);
          background:rgba(var(--brand-primary-rgb),0.14);
        }

        /* Category quick-filter chips — one per category, shown next to the
           Filtros toggle. Clicking one narrows the feed to that category
           (drives the same filterCat state as the dropdown). Horizontally
           scrollable so the row never wraps under the toggle. */
        .v-cat-pills{
          display:flex;align-items:center;gap:8px;
          overflow-x:auto;scrollbar-width:none;flex:1 1 auto;min-width:0;
          padding-bottom:2px;-webkit-overflow-scrolling:touch;
        }
        .v-cat-pills::-webkit-scrollbar{display:none;}
        .v-cat-pill{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:11.5px;font-weight:500;letter-spacing:.04em;
          padding:8px 14px;border-radius:999px;cursor:pointer;white-space:nowrap;flex-shrink:0;
          border:1px solid rgba(var(--brand-primary-rgb),0.18);
          background:var(--v-bg-elevated);color:var(--v-text-secondary);
          transition:color .25s ease,border-color .25s ease,background .25s ease;
        }
        .v-cat-pill:hover{color:var(--v-text-primary);border-color:rgba(var(--brand-primary-rgb),0.4)}
        .v-cat-pill.active{
          color:var(--v-accent-strong);
          border-color:rgba(var(--brand-primary-rgb),0.5);
          background:rgba(var(--brand-primary-rgb),0.08);
        }
        @media(max-width:639px){ .v-cat-pill{font-size:10.5px;padding:7px 12px} }
        /* "Todas" is redundant on mobile (no chip selected already = all);
           hide it there to save horizontal room in the chip row. */
        @media(max-width:767px){ .v-cat-pill-all{display:none} }

        /* Collapsible filter panel */
        .v-filter-collapsible{display:none;}

        /* Post grid responsive */
        .v-post-grid{
          display:grid;
          grid-template-columns:repeat(3,1fr);
          gap:16px;
        }
        /* Keep desktop proportions aligned with mobile per design:
           fewer but roomier columns, and the same typographic overrides
           across all breakpoints so the feed looks consistent. */
        @media(max-width:767px){
          .v-post-grid{grid-template-columns:repeat(2,1fr);gap:10px}
        }
        @media(max-width:639px){
          .v-post-grid{grid-template-columns:repeat(2,1fr);gap:8px}
          .v-tier-badge{font-size:7px!important;padding:2px 6px!important}
          .v-promo-badge{font-size:7px!important;padding:2px 6px!important;top:8px;left:8px}
          .v-location-badge{font-size:7px!important;padding:2px 6px!important;letter-spacing:.1em!important}
        }

        /* Filter bar — same grid on all sizes */
        @media(max-width:639px){
          .v-filter-input,.v-filter-select,.v-filter-pill{font-size:9px}
          .v-dropdown{position:fixed;bottom:0;left:0;right:0;top:auto;min-width:unset;border-radius:0;max-height:55vh;overflow-y:auto}
          /* Drop the sticky filter bar's backdrop-blur on mobile — on
             mid-range Android/iOS the GPU compositing cost on every
             scroll frame outweighs the aesthetic. The solid dark bg
             underneath (0.97 opacity) gives us the same contrast. */
          .v-filter-sticky-bar{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
        }

      `}</style>

      <section className="v-hero">
        <div className="v-hero-bg" aria-hidden="true" />
        <div className="v-hero-overlay" />
        <div className="v-hero-content">
          <h2 className="v-hero-heading">
            {t(lang, 'feed_hero_pre')} <strong className="v-hero-heading-accent">{t(lang, 'feed_hero_accent')}</strong>
          </h2>

          <div className="v-hero-search-wrap">
            <span className="v-search-icon">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="9" cy="9" r="6"/><path d="M14 14l4 4"/>
              </svg>
            </span>
            <input
              type="text"
              placeholder={t(lang, 'feed_search_ph')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="v-hero-input"
              onFocus={() => { if (searchBlurTimer.current) clearTimeout(searchBlurTimer.current); setSearchFocused(true) }}
              onBlur={() => { searchBlurTimer.current = setTimeout(() => setSearchFocused(false), 150) }}
            />
            {search && (
              <button className="v-search-clear" onClick={() => setSearch('')}>✕</button>
            )}
            {searchFocused && !search && (
              <div className="v-search-dropdown">
                <div className="v-search-dropdown-label">{t(lang, 'feed_trends')}</div>
                {['Servicio', 'Perfil', 'Eventos', 'GFE', 'Domicilio'].map(s => (
                  <div key={s} className="v-search-suggestion" onMouseDown={() => { setSearch(s); setSearchFocused(false) }}>
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <circle cx="9" cy="9" r="6"/><path d="M14 14l4 4"/>
                    </svg>
                    {s}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="v-hero-pills">
            {(
              [
                {
                  key: 'v', labelKey: 'feed_pill_video',
                  on: qConVideo, set: setQConVideo,
                  icon: <polygon points="5 3 19 12 5 21 5 3" />,
                  iconFill: true,
                },
                {
                  key: 'x', labelKey: 'feed_pill_reviews',
                  on: qExperiencias, set: setQExperiencias,
                  icon: <path d="M21 11.5a8.5 8.5 0 0 1-13 7.2L3 21l2.3-5A8.5 8.5 0 1 1 21 11.5z" strokeLinecap="round" />,
                  iconFill: false,
                },
                {
                  key: 'pr', labelKey: 'feed_pill_promo',
                  on: qPromocion, set: setQPromocion,
                  icon: <path d="M12 2 L14.4 9 L22 9.5 L16 14 L18 22 L12 17.5 L6 22 L8 14 L2 9.5 L9.6 9 Z" />,
                  iconFill: false,
                },
              ] as const
            ).map(p => (
              <button
                key={p.key}
                onClick={() => p.set(!p.on)}
                className={`v-hero-pill${p.on ? ' active' : ''}`}
                aria-pressed={p.on}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill={p.iconFill ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="v-hero-pill-icon"
                >
                  {p.icon}
                </svg>
                {t(lang, p.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {STORIES_ENABLED && <CityStoryTray posts={posts} countryId={countryId} />}

      <div
        className="v-filter-sticky-bar"
        style={{
          borderBottom:'1px solid var(--v-border-subtle)',
          background:'rgba(var(--v-bg-base-rgb),0.97)',backdropFilter:'blur(12px)',
          overflow:'visible',
        }}
      >
        <div style={{maxWidth:'1400px',margin:'0 auto',padding:'12px 16px'}}>
        <div className="v-filter-bar">

          <div className="v-filter-toggle-row" style={{flexWrap:'nowrap'}}>
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className={`v-filter-toggle-btn${filterOpen ? ' active' : ''}`}
            >
              {t(lang, 'feed_filters')} {filterOpen ? '▴' : '▾'}
              {hasActiveFilters && !filterOpen && (
                <span style={{background:'var(--v-accent)',color:'var(--v-text-inverse)',borderRadius:'50%',width:'16px',height:'16px',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'8px',fontWeight:400}}>
                  {[filterCat,filterTier,...filterServicios,...filterAtributos,filterMinCLP>0?'1':'',filterMaxCLP<MAX_CLP?'1':'',qExperiencias?'1':'',qPromocion?'1':'',qConVideo?'1':''].filter(Boolean).length}
                </span>
              )}
            </button>

            <div className="v-cat-pills" role="group" aria-label={t(lang, 'filter_category')}>
              <button
                onClick={() => setFilterCat('')}
                className={`v-cat-pill v-cat-pill-all${!filterCat ? ' active' : ''}`}
                aria-pressed={!filterCat}
              >
                {t(lang, 'feed_all')}
              </button>
              {dynCategories
                .filter(c => availableCats.has(c.id) && !hiddenCats.has(c.id))
                .map(c => (
                  <button
                    key={c.id}
                    onClick={() => setFilterCat(filterCat === c.id ? '' : c.id)}
                    className={`v-cat-pill${filterCat === c.id ? ' active' : ''}`}
                    aria-pressed={filterCat === c.id}
                  >
                    {tOption(lang, c.label)}
                  </button>
                ))}
            </div>
          </div>

          <div className="v-filter-collapsible" style={filterOpen ? {display:'block'} : {}}>
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>

          <div className="v-filter-grid">

            <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="v-filter-select">
              <option value="">{t(lang, 'filter_category')}</option>
              {dynCategories.filter(c => availableCats.has(c.id) && (c.id === 'mujer' || !hiddenCats.has(c.id))).map(c => <option key={c.id} value={c.id}>{tOption(lang, c.label)}</option>)}
            </select>

            <select value={filterTier} onChange={e => setFilterTier(e.target.value)} className="v-filter-select">
              <option value="">{t(lang, 'filter_tier')}</option>
              {TIERS.filter(tier => availableTiers.has(tier.id)).map(tier => <option key={tier.id} value={tier.id}>{tier.label}</option>)}
            </select>

            <select value={filterProvinciaSlug} onChange={e => { setFilterProvinciaSlug(e.target.value); setFilterComunaSlug('') }} className="v-filter-select">
              <option value="">{t(lang, 'feed_provincia')}</option>
              {geoFilter.provincias.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
            </select>

            <select value={filterComunaSlug} onChange={e => setFilterComunaSlug(e.target.value)} className="v-filter-select" disabled={!filterProvinciaSlug || geoFilter.comunas.length === 0}>
              <option value="">{t(lang, 'feed_comuna')}</option>
              {geoFilter.comunas.map(c => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </select>

            {filterAOptions.length > 0 && (
              <div className="v-dropdown-wrap" style={{width:'100%'}}>
                <button
                  onClick={() => { setShowSvDropdown(!showSvDropdown); setShowAtDropdown(false) }}
                  className={`v-filter-pill ${filterServicios.length ? 'active' : ''}`}
                  style={{width:'100%',justifyContent:'center'}}
                >
                  {getAttributeDef(FILTER_A_KEY)?.label ?? ''}{filterServicios.length ? ` (${filterServicios.length})` : ''}
                </button>
                {showSvDropdown && (
                  <div className="v-dropdown">
                    {filterAOptions.map(s => (
                      <button
                        key={s}
                        onClick={() => setFilterServicios(filterServicios.includes(s) ? filterServicios.filter(x => x !== s) : [...filterServicios, s])}
                        className={`v-dropdown-chip ${filterServicios.includes(s) ? 'selected' : ''}`}
                      >{tOption(lang, s)}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {filterBOptions.length > 0 && (
              <div className="v-dropdown-wrap" style={{width:'100%'}}>
                <button
                  onClick={() => { setShowAtDropdown(!showAtDropdown); setShowSvDropdown(false) }}
                  className={`v-filter-pill ${filterAtributos.length ? 'active' : ''}`}
                  style={{width:'100%',justifyContent:'center'}}
                >
                  {getAttributeDef(FILTER_B_KEY)?.label ?? ''}{filterAtributos.length ? ` (${filterAtributos.length})` : ''}
                </button>
                {showAtDropdown && (
                  <div className="v-dropdown">
                    {filterBOptions.map(a => (
                      <button
                        key={a}
                        onClick={() => setFilterAtributos(filterAtributos.includes(a) ? filterAtributos.filter(x => x !== a) : [...filterAtributos, a])}
                        className={`v-dropdown-chip ${filterAtributos.includes(a) ? 'selected' : ''}`}
                      >{tOption(lang, a)}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{display:'flex',alignItems:'center',gap:'8px',width:'100%'}}>
            <span style={{fontFamily:"'Switzer','Inter','Helvetica Neue',Arial,sans-serif",fontSize:'11px',fontWeight: 400,letterSpacing:'.04em',color:'var(--v-text-secondary)',flexShrink:0}}>
              {t(lang, 'filter_price_range')}
            </span>
            <select value={filterCurrency} onChange={e => setFilterCurrency(e.target.value)} className="v-filter-select" style={{flexShrink:0,padding:'6px 8px',height:'32px',fontSize:'11px',letterSpacing:'.04em'}}>
              <option>ARS</option>
              <option>USD</option>
              <option>EUR</option>
            </select>
            <div style={{position:'relative',flex:1,height:'24px',display:'flex',alignItems:'center'}}>
              <div style={{position:'absolute',left:0,right:0,height:'3px',background:'rgba(var(--brand-primary-rgb),0.12)',borderRadius:'6px'}}>
                <div style={{position:'absolute',height:'100%',background:'var(--v-accent)',borderRadius:'6px',left:`${(filterMinCLP/MAX_CLP)*100}%`,right:`${((MAX_CLP-filterMaxCLP)/MAX_CLP)*100}%`}} />
              </div>
              <div style={{position:'absolute',width:'12px',height:'12px',borderRadius:'50%',background:'var(--v-accent)',border:'2px solid var(--v-bg-base)',top:'50%',transform:'translate(-50%,-50%)',left:`${(filterMinCLP/MAX_CLP)*100}%`,pointerEvents:'none',zIndex:3}} />
              <div style={{position:'absolute',width:'12px',height:'12px',borderRadius:'50%',background:'var(--v-accent)',border:'2px solid var(--v-bg-base)',top:'50%',transform:'translate(-50%,-50%)',left:`${(filterMaxCLP/MAX_CLP)*100}%`,pointerEvents:'none',zIndex:3}} />
              <input type="range" min={0} max={MAX_CLP} step={50000} value={filterMinCLP} onChange={e => { const v=Number(e.target.value); if(v<=filterMaxCLP) setFilterMinCLP(v) }} className="v-range-input" style={{zIndex: filterMinCLP >= filterMaxCLP - 50000 ? 4 : 2}} />
              <input type="range" min={0} max={MAX_CLP} step={50000} value={filterMaxCLP} onChange={e => { const v=Number(e.target.value); if(v>=filterMinCLP) setFilterMaxCLP(v) }} className="v-range-input" style={{zIndex: filterMaxCLP <= filterMinCLP + 50000 ? 4 : 2}} />
            </div>
            <span style={{fontFamily:"'Switzer','Inter','Helvetica Neue',Arial,sans-serif",fontSize:'9px',fontWeight: 400,color:'var(--v-text-tertiary)',letterSpacing:'.04em',flexShrink:0,whiteSpace:'nowrap',minWidth:'100px',textAlign:'right'}}>
              {CURR_SYMBOL[filterCurrency]}{clpToDisplay(filterMinCLP, filterCurrency).toLocaleString(DISPLAY_LOCALE)}–{CURR_SYMBOL[filterCurrency]}{Math.min(clpToDisplay(filterMaxCLP, filterCurrency), CURR_MAX[filterCurrency]).toLocaleString(DISPLAY_LOCALE)}
            </span>
          </div>

          {hasActiveFilters && (
            <button onClick={clearFilters} className="v-filter-pill" style={{color:'var(--v-error)',borderColor:'rgba(224,85,85,0.2)',alignSelf:'flex-start'}}>
              {t(lang, 'filter_clear')}
            </button>
          )}

          </div>
          </div>

        </div>
        </div>
      </div>

      <div style={{maxWidth:'1400px',margin:'0 auto',padding:'40px 16px'}}>
        {filtered.length === 0 ? (
          <div style={{textAlign:'center',padding:'80px 24px',border:'1px dashed rgba(var(--brand-primary-rgb),0.1)',borderRadius:'6px'}}>
            <p style={{fontFamily:"'Switzer','Inter','Helvetica Neue',Arial,sans-serif",fontSize:'clamp(18px,3vw,26px)',fontWeight:400,color:'var(--v-text-tertiary)',marginBottom:'24px'}}>
              {t(lang, 'filter_no_results')}
            </p>
            <button
              onClick={clearFilters}
              style={{fontFamily:"'Switzer','Inter','Helvetica Neue',Arial,sans-serif",fontSize:'9px',fontWeight: 400,letterSpacing: '.2em',textTransform:'uppercase',color:'var(--v-accent-strong)',border:'1px solid rgba(var(--brand-primary-rgb),0.25)',padding:'10px 24px',borderRadius:'6px',background:'transparent',cursor:'pointer'}}
            >
              {t(lang, 'filter_clear_btn')}
            </button>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:'56px'}}>

            {grouped.map(({ cat, posts: catPosts }) => (
              <section key={cat.id}>
                <div style={{display:'flex',alignItems:'baseline',gap:'14px',marginBottom:'24px',paddingBottom:'14px',borderBottom:'1px solid rgba(var(--brand-primary-rgb),0.08)'}}>
                  <h2 className="v-cat-header">{tOption(lang, cat.label)}</h2>
                  <span style={{fontFamily:"'Switzer','Inter','Helvetica Neue',Arial,sans-serif",fontSize:'12px',fontWeight: 400,letterSpacing: '.04em',color:'var(--v-text-secondary)'}}>
                    {catPosts.length} {t(lang, catPosts.length === 1 ? 'feed_anuncio' : 'feed_anuncios')}
                  </span>
                </div>
                <div className="v-post-grid">
                  {catPosts.map((post, idx) => (
                    <PostCard key={post.id} post={post} idx={idx} showTierBadge />
                  ))}
                </div>
              </section>
            ))}

            {uncategorized.length > 0 && (
              <section>
                <div style={{display:'flex',alignItems:'center',gap:'16px',marginBottom:'24px',paddingBottom:'14px',borderBottom:'1px solid rgba(var(--brand-primary-rgb),0.08)'}}>
                  <h2 className="v-cat-header" style={{color:'var(--v-text-tertiary)'}}>{t(lang, 'feed_general')}</h2>
                </div>
                <div className="v-post-grid">
                  {uncategorized.map((post, idx) => (
                    <PostCard key={post.id} post={post} idx={idx} showTierBadge={false} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  )
}
