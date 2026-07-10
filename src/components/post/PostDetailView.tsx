'use client'
import { supabaseFetch, getUserId } from '@/lib/supabase/direct'
import { useEffect, useState, useRef, useSyncExternalStore } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { CATEGORIES, TIERS, TIER_BADGE_STYLES } from '@/lib/categories'
import { getAttributeGroups, type AttributeDef } from '@/config/attributes.config'
import { useLang } from '@/contexts/LanguageContext'
import { useCarouselRail } from '@/hooks/useCarouselRail'
import { t, tOption } from '@/lib/i18n'
import PostExperiencias from '@/components/PostExperiencias'
import { ProtectedImage } from '@/components/ProtectedMedia'
import MarketplaceLoader from '@/components/MarketplaceLoader'
import ReportModal from '@/components/post/ReportModal'
import PostStoryViewer from '@/components/post/PostStoryViewer'
import GalleryLightbox from '@/components/post/GalleryLightbox'
import type { Post, Story } from '@/lib/types/post'
import { trackEvent } from '@/lib/analytics'
import { postCanonicalPath } from '@/lib/post-url'
import { getWatermarkedVideoUrl, getWatermarkedImageUrl, getCloudinaryUrl, getProfileCircleUrl } from '@/lib/cloudinary'
import { isWithinSchedule } from '@/lib/schedule'
import { kycEnabled } from '@/lib/kyc'
import { STORIES_ENABLED, REVIEWS_ENABLED, MARKET_CURRENCY, DISPLAY_LOCALE } from '@/config/marketplace.config'
import {
  subscribeSeenStories,
  getSeenStoryIdsSnapshot,
  getSeenStoryIdsServerSnapshot,
  markStoriesSeen,
  areAllSeen,
} from '@/lib/story-seen'

// Verified badge only surfaces when the KYC module is enabled (FEATURE_KYC).
const KYC_ON = kycEnabled()

type Props = {
  /** Post alias or UUID from the URL. */
  id: string
  /** Country slug from the URL (always lowercased). */
  countrySlug: string
}

/**
 * Format a stored attribute value for display, appending the attribute unit
 * for numbers. Multiselect values come back as a string[] — callers that need
 * per-chip rendering should branch on the array before calling this.
 */
function formatAttributeValue(attr: AttributeDef, raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return ''
  if (Array.isArray(raw)) return raw.join(', ')
  if (typeof raw === 'boolean') return raw ? 'Sí' : 'No'
  if (typeof raw === 'number' && attr.unit) return `${raw} ${attr.unit}`
  return String(raw)
}

function hasAttributeValue(attributes: Record<string, unknown> | undefined, attr: AttributeDef): boolean {
  const raw = attributes?.[attr.key]
  if (raw === null || raw === undefined || raw === '') return false
  if (Array.isArray(raw)) return raw.length > 0
  return true
}

export default function PostDetailView({ id, countrySlug }: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const fromAdmin    = searchParams.get('from') === 'admin'

  const [post, setPost]                 = useState<Post | null>(null)
  const [contactPhone, setContactPhone] = useState<string | null>(null)
  const [contactTelegram, setContactTelegram] = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  // Distinguishes "could not load" from "truly not found".
  const [fetchFailed, setFetchFailed]   = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [userId, setUserId]             = useState<string | null>(null)
  const [postStories, setPostStories]   = useState<Story[]>([])
  // Captured once at mount — the promo "valid X days" badge only needs
  // a reference point that matches the session; the React Compiler
  // rejects Date.now() inline in render (impure function rule).
  const [mountedAt] = useState(() => Date.now())
  const [storyOpen,   setStoryOpen]     = useState(false)
  const seenStoryIds = useSyncExternalStore(
    subscribeSeenStories,
    getSeenStoryIdsSnapshot,
    getSeenStoryIdsServerSnapshot,
  )

  const storyIds = postStories.map(s => s.id).filter(Boolean) as string[]
  const storiesSeen = areAllSeen(storyIds, seenStoryIds)

  const closeStoryViewer = () => {
    setStoryOpen(false)
    if (storyIds.length > 0) markStoriesSeen(storyIds)
  }
  const descRef        = useRef<HTMLParagraphElement>(null)
  const [descOverflow, setDescOverflow] = useState(false)
  const [stickyFav, setStickyFav] = useState(false)

  const [reportOpen, setReportOpen] = useState(false)
  const [reportPresetCategory] = useState<string | undefined>(undefined)
  const [recommendations, setRecommendations] = useState<Post[]>([])
  // Recommendations rail: mouse grab-to-scroll (native overflow-x only pans
  // via trackpad / shift+wheel) + infinite loop (last card wraps back to the
  // first). When `recLoop` is true we render 3 copies of the list so the
  // hook can wrap the scroll seamlessly.
  const [recLoop, setRecLoop] = useState(false)
  const recRailRef = useCarouselRail<HTMLDivElement>({
    infinite: true,
    itemCount: recommendations.length,
    onLoopChange: setRecLoop,
  })
  const { lang } = useLang()

  useEffect(() => {
    // Cancellation flag — Supabase SDK doesn't accept AbortSignal, so we gate
    // every setState after an `await` instead. Prevents "setState on unmounted
    // component" warnings when the user navigates away mid-fetch (e.g. fast
    // back/forward between post pages).
    let cancelled = false
    const fetchPostAndContact = async () => {
      // id_document_url is intentionally excluded — private field, never sent to public pages
      const postFields = 'id, title, description, price, currency, country_id, provincia_id, comuna_id, barrio_id, whatsapp_number, telegram_number, image_urls, video_urls, audio_url, audio_filename, category, tier, status, is_approved, identity_verified, user_id, rejection_reason, localidad, attributes, is_promoted, promo_price, promo_ends_at, is_online, favorites_count, cover_video_url, profile_photo_url, price_usd, price_eur, countries(slug,name)'
      // Support both UUID and name-slug URLs. For slug lookups we scope the
      // query to the URL's country so slugs are only unique-per-country.
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      // Direct PostgREST instead of the @supabase/ssr SDK: for logged-in users
      // the very first `supabase.from('posts').select()` returned a Promise that
      // never resolved AND never made a network request, so `loading` stayed
      // true forever. Trade-off: we lose the `error.code === 'PGRST116'`
      // semantic for "no rows" vs other errors, but in this view we only care
      // about "got a row" vs "didn't" so reading `data?.[0]` covers both.
      let postData: Post | null = null
      let transientError = false
      try {
        if (isUUID) {
          const path = `posts?select=${encodeURIComponent(postFields)}&id=eq.${encodeURIComponent(id)}&limit=1`
          const { data, error } = await supabaseFetch<Post[]>(path)
          if (cancelled) return
          if (error) {
            console.error('[post-detail] post fetch by uuid failed', error)
            transientError = true
          }
          postData = data?.[0] ?? null
        } else {
          // Resolve URL country slug → country_id for slug-based disambiguation.
          const countryPath = `countries?select=id&slug=eq.${encodeURIComponent(countrySlug)}&limit=1`
          const { data: countryRows, error: countryErr } = await supabaseFetch<{ id: string }[]>(countryPath)
          if (cancelled) return
          if (countryErr) console.error('[post-detail] country lookup failed', countryErr)
          const countryId = countryRows?.[0]?.id ?? null
          const scopeFilter = countryId ? `&country_id=eq.${encodeURIComponent(countryId)}` : ''

          const slugPath = `posts?select=${encodeURIComponent(postFields)}${scopeFilter}&post_slug=eq.${encodeURIComponent(id)}&limit=1`
          const { data: slugRows, error } = await supabaseFetch<Post[]>(slugPath)
          if (cancelled) return
          if (error) {
            console.error('[post-detail] post fetch by slug failed', error)
            transientError = true
          }
          postData = slugRows?.[0] ?? null

          if (!postData) {
            const titlePattern = id.replace(/-/g, ' ')
            const fbPath = `posts?select=${encodeURIComponent(postFields)}${scopeFilter}&title=ilike.${encodeURIComponent('%' + titlePattern + '%')}&limit=1`
            const { data: fbRows, error: fbErr } = await supabaseFetch<Post[]>(fbPath)
            if (cancelled) return
            if (fbErr) {
              console.error('[post-detail] post title fallback failed', fbErr)
              transientError = true
            }
            postData = fbRows?.[0] ?? null
          }
        }

        // If the post lookup errored AND returned nothing, surface the retry
        // screen. If we got a post back, continue — the error was incidental
        // (e.g. a soft 406 on the fallback that still found the row).
        if (transientError && !postData) {
          setFetchFailed(true)
          return
        }

        // Decode user id from the cookie's JWT instead of a network round-trip.
        // `getUserId()` is a pure local cookie-parse, so it can't fall into the
        // same SDK hang the post fetch above tripped on.
        const userId = getUserId()
        if (cancelled) return
        setUserId(userId)

        if (postData) {
          setPost(postData)
          trackEvent(id, 'view', undefined, userId ?? undefined)
          let phoneToUse = postData.whatsapp_number
          if (!phoneToUse && postData.user_id) {
            // Soft-fail: a profile fetch blip shouldn't break the page — it
            // just means the WhatsApp button stays disabled. Log so we notice
            // if this ever becomes systemic. Skip outright if `user_id` is
            // missing — there's no profile to query.
            const profPath = `profiles?select=phone&id=eq.${encodeURIComponent(postData.user_id)}&limit=1`
            const { data: profRows, error: profileErr } = await supabaseFetch<{ phone: string | null }[]>(profPath)
            if (cancelled) return
            if (profileErr) {
              console.error('[post-detail] profile phone fetch failed', profileErr)
            } else {
              phoneToUse = profRows?.[0]?.phone ?? null
            }
          }
          if (phoneToUse) setContactPhone(phoneToUse.replace(/\D/g, ''))
          if (postData.telegram_number) {
            setContactTelegram(postData.telegram_number.replace(/\D/g, ''))
          }

          // Fetch active stories for this post (uses real UUID). Soft-fail:
          // the story ring just won't appear if this errors. Skipped entirely
          // when the Stories add-on is off — postStories stays [] so every story
          // render site (rings + viewer, all guarded by postStories.length) is inert.
          if (STORIES_ENABLED) {
            const nowISO = new Date().toISOString()
            const storyPath = `stories?select=*&post_id=eq.${encodeURIComponent(postData.id)}&expires_at=gt.${encodeURIComponent(nowISO)}&order=created_at.asc`
            const { data: storyData, error: storyErr } = await supabaseFetch<Story[]>(storyPath)
            if (cancelled) return
            if (storyErr) console.error('[post-detail] stories fetch failed', storyErr)
            setPostStories(storyData || [])
          }
        }
      } catch (err) {
        if (cancelled) return
        // Network-level throws (vs PostgREST { error } tuples) land here.
        console.error('[post-detail] unexpected fetch error', err)
        setFetchFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchPostAndContact()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Fetch recommendations based on location proximity. The queries are cheap
  // (indexed anon reads), so we issue all applicable ones in parallel, merge
  // the results in priority order, and dedup by id as we go.
  useEffect(() => {
    if (!post) return
    let cancelled = false
    const fetchRecs = async () => {
      const loc = (post.localidad || '').split(',').map((s: string) => s.trim()).filter(Boolean)
      const recFields = 'id, title, price, price_usd, currency, country_id, image_urls, cover_video_url, localidad, attributes, post_slug, tier, category, identity_verified, is_promoted, promo_price, promo_ends_at, countries(slug,name), provincias(slug), comunas(slug)'
      // Direct PostgREST URLs (same rationale as fetchPostAndContact above —
      // SDK calls hang for logged-in users on this view). The hidden+paused
      // filters need null-safe semantics (treat NULL as "not hidden") so we
      // wrap them in `and(or(...),or(...))` rather than the simpler
      // `not.eq.true` shorthand, which would drop NULL rows.
      const baseSelect = `posts?select=${encodeURIComponent(recFields)}`
      const baseFilters = `&status=eq.published&is_approved=eq.true&id=neq.${encodeURIComponent(post.id)}&and=(or(is_hidden.is.null,is_hidden.eq.false),or(is_paused.is.null,is_paused.eq.false))`

      // Build the set of queries applicable for this post. Priority 1/2 are
      // skipped when there's no localidad / barrio to filter on; priority 3
      // is skipped when country_id is null. Priority 4 always fires so the
      // carousel never ends up empty.
      type RecQ = { tag: string; promise: Promise<{ data: Post[] | null; error: unknown }> }
      const queries: RecQ[] = []
      if (loc.length > 0) queries.push({ tag: 'p1-localidad', promise: supabaseFetch<Post[]>(`${baseSelect}${baseFilters}&localidad=ilike.${encodeURIComponent('%' + loc[0] + '%')}&limit=12`) })
      if (loc.length > 1) queries.push({ tag: 'p2-barrio',    promise: supabaseFetch<Post[]>(`${baseSelect}${baseFilters}&localidad=ilike.${encodeURIComponent('%' + loc[1] + '%')}&limit=12`) })
      if (post.country_id) queries.push({ tag: 'p3-country',   promise: supabaseFetch<Post[]>(`${baseSelect}${baseFilters}&country_id=eq.${encodeURIComponent(post.country_id)}&limit=12`) })
      queries.push({ tag: 'p4-any', promise: supabaseFetch<Post[]>(`${baseSelect}${baseFilters}&limit=12`) })

      try {
        const results = await Promise.all(queries.map(q => q.promise))
        if (cancelled) return

        // Merge in priority order. Dedup by id as we append so the first
        // occurrence wins.
        const seen = new Set<string>([post.id])
        const recs: Post[] = []
        results.forEach((result, idx) => {
          const { data, error } = result
          const { tag } = queries[idx]
          if (error) console.error(`[post-detail] recs ${tag} failed`, error)
          if (!data) return
          for (const r of data) {
            if (recs.length >= 12) break
            if (seen.has(r.id)) continue
            seen.add(r.id)
            recs.push(r)
          }
        })
        if (!cancelled) setRecommendations(recs.slice(0, 12))
      } catch (err) {
        if (cancelled) return
        console.error('[post-detail] recommendations fetch threw', err)
      }
    }
    fetchRecs()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id])

  useEffect(() => {
    if (descRef.current) {
      setDescOverflow(descRef.current.scrollHeight > descRef.current.clientHeight)
    }
  }, [post?.description])

  const handleBack = () => fromAdmin ? router.push('/admin') : router.push(`/${countrySlug}`)

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--v-bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <MarketplaceLoader variant="block" />
    </div>
  )

  // Transient error (network/RLS). Give the user a retry affordance instead
  // of the confusing "no encontrada" screen they'd see otherwise.
  if (fetchFailed) return (
    <div style={{ minHeight: '100vh', background: 'var(--v-bg-base)', color: 'var(--v-text-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '24px', textAlign: 'center' }}>
      <h1 style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '28px', fontWeight:400, color: 'var(--v-accent-strong)', fontVariantNumeric: 'tabular-nums' }}>{t(lang, 'pd_load_failed')}</h1>
      <p style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '13px', fontWeight: 400, color: 'var(--v-text-secondary)', maxWidth: '420px', lineHeight: 1.5 }}>{t(lang, 'pd_load_failed_body')}</p>
      <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
        <button onClick={() => window.location.reload()} style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px', fontWeight: 400, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--v-accent-strong)', background: 'transparent', border: '1px solid var(--v-accent)', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer' }}>{t(lang, 'pd_retry')}</button>
        <button onClick={handleBack} style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px', fontWeight: 400, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--v-text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer' }}>← {t(lang, 'back')}</button>
      </div>
    </div>
  )

  if (!post) return (
    <div style={{ minHeight: '100vh', background: 'var(--v-bg-base)', color: 'var(--v-text-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
      <h1 style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '28px', fontWeight:400, color: 'var(--v-accent-strong)' , fontVariantNumeric: 'tabular-nums' }}>{t(lang, 'pd_not_found')}</h1>
      <button onClick={handleBack} style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px', fontWeight: 400, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--v-text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer' }}>← {t(lang, 'back')}</button>
    </div>
  )

  const images  = (post.image_urls || []) as string[]
  const profilePhotoCandidate = post.profile_photo_url
  const profilePhotoFromImages = profilePhotoCandidate && images.includes(profilePhotoCandidate)
    ? profilePhotoCandidate
    : images[0]
  const orderedImages = profilePhotoFromImages
    ? [profilePhotoFromImages, ...images.filter(u => u !== profilePhotoFromImages)]
    : []

  // All posts get the Marketplace watermark burned in at render. Applied as
  // a Cloudinary overlay transform — stored image_urls stay clean. Feed
  // cards pick up their watermark via getCloudinaryUrl() (which also
  // handles sizing); here the full-res renders (hero cover, story ring,
  // gallery lightbox) go through getWatermarkedImageUrl() directly
  // because no size transform runs at this stage.
  const galleryImages = orderedImages.slice(1).map(u => getWatermarkedImageUrl(u))
  const videos  = (post.video_urls || []) as string[]
  const coverImg = orderedImages[0] ? getWatermarkedImageUrl(orderedImages[0]) : null
  const circleImg = orderedImages[0] ? getProfileCircleUrl(orderedImages[0]) : null

  const galleryItems: Array<{ type: 'image'; url: string } | { type: 'video'; url: string; poster: string }> = [
    ...videos.map(rawUrl => ({
      type: 'video' as const,
      url: getWatermarkedVideoUrl(rawUrl),
      poster: rawUrl.replace(/\.(mp4|webm|mov)(\?|$)/i, '.jpg$2'),
    })),
    ...galleryImages.map(url => ({ type: 'image' as const, url })),
  ]

  // Promo countdown. Uses `mountedAt` (captured at mount) as the reference
  // point so the number doesn't tick mid-session; React Compiler rejects
  // Date.now() inline in render as an impure call.
  const promoDays = post.promo_ends_at
    ? Math.ceil((new Date(post.promo_ends_at).getTime() - mountedAt) / (1000 * 60 * 60 * 24))
    : null

  const currencySymbol = post.currency === 'BRL' ? 'R$' : post.currency === 'EUR' ? '€' : '$'
  // Primary display = USD when available; ARS / EUR fall to the optional methods row below.
  const priceDisplay   = post.price_usd
    ? `${Math.round(post.price_usd).toLocaleString('en-US')} USD`
    : `${currencySymbol}${post.price?.toLocaleString(DISPLAY_LOCALE)} ${post.currency && post.currency !== 'CLP' ? post.currency : ''}`.trim()
  const formatPrice = (n: number): string =>
    post.price_usd
      ? `${Math.round(n).toLocaleString('en-US')} USD`
      : `${currencySymbol}${n.toLocaleString(DISPLAY_LOCALE)}${post.currency && post.currency !== 'CLP' ? ' ' + post.currency : ''}`

  const catDef   = CATEGORIES.find(c => c.id === post.category)
  const tierDef  = TIERS.find(t => t.id === post.tier)
  const tierStyle = post.tier ? TIER_BADGE_STYLES[post.tier] ?? null : null

  return (
    <>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }
        .vd-fade { opacity:0; animation:fadeUp .7s cubic-bezier(.22,1,.36,1) forwards; }

        /* Mirrors the legal-row treatment used by GeoFeedPage's footer so
           the post-detail footer below renders consistently with /argentina. */
        .v-legal-link{ color:var(--v-text-tertiary); text-decoration:none; transition:color .4s ease; }
        .v-legal-link:hover{ color:var(--v-accent-strong) }

        .vd-divider {
          height:1px;
          background:var(--v-border-subtle);
          margin:36px 0;
        }

        /* ── Mobile tap targets ── */
        @media (max-width: 639px) {
          .vd-back-btn { display:none !important; }
          .vd-fav-wrap { min-width:44px; min-height:44px; display:flex; align-items:center; }
        }
        /* Lightbox arrows hidden on touch-first viewports — swipe
           already advances the gallery and the 40 px circular chevrons
           were crowding the image edges on phones. Desktop (≥768 px)
           keeps them for mouse users who can't swipe. */
        @media (max-width: 767px) {
          .vd-lb-btn { display:none !important; }
        }

        .vd-section-title {
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:17px;font-weight:500;letter-spacing:.08em;
          text-transform:uppercase;color:var(--v-accent-strong);
          margin-bottom:20px;
        }

        .vd-tag {
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:14px;font-weight:400;
          letter-spacing:.02em;color:var(--v-text-primary);
          border:1px solid var(--v-border);padding:7px 14px;border-radius:6px;
        }

        /* Gallery — unified grid for photos + videos. Replaces the legacy
           grids (.vd-photo-grid 3-col and .vd-video-grid 2-col with inline
           video player) with a single visual gallery where videos render as
           a tile with poster + play icon overlay. Tap opens the lightbox,
           which now supports videos. */
        .vd-gallery-grid {
          display:grid;
          grid-template-columns:repeat(3,1fr);
          gap:8px;
        }
        @media(max-width:767px) {
          .vd-gallery-grid { grid-template-columns:repeat(2,1fr); gap:6px; }
          /* Mobile caps at 4 tiles. Items past that cap are hidden; the 4th
             shows a "+N · Ver todas" overlay to reach the rest via the
             lightbox. Desktop ignores these rules — 3-col grid with all
             items visible. */
          .vd-gallery-item-mobile-hidden { display:none; }
        }

        .vd-gallery-item {
          position:relative;
          aspect-ratio:3/4;
          overflow:hidden;border-radius:6px;
          /* Neutral photo-glyph placeholder stays behind the <img> so lazy-loaded
             thumbs show a subtle light panel instead of the browser's alt
             fallback while the Cloudinary transform is fetched. */
          background:var(--v-bg-elevated) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20'/%3E%3C/svg%3E") center/64px no-repeat;
          cursor:pointer;
          transition:opacity .3s ease;
        }
        .vd-gallery-item:hover { opacity:.85; }
        .vd-gallery-item img { width:100%;height:100%;object-fit:cover;display:block; }

        /* Video tile chrome — play icon overlay (accent over a dark backdrop)
           + "Video" tag top-right. No click handler of its own; the
           .vd-gallery-item wrapper already captures the tap. */
        .vd-gallery-video-tag {
          position:absolute;
          top:8px;right:8px;
          background:rgba(8,8,8,0.6);
          -webkit-backdrop-filter:blur(4px);
          backdrop-filter:blur(4px);
          color:var(--v-accent);
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:9px;font-weight:500;
          letter-spacing:.14em;text-transform:uppercase;
          padding:3px 7px;
          border-radius:3px;
          z-index:2;
        }
        .vd-gallery-play {
          position:absolute;inset:0;
          display:flex;align-items:center;justify-content:center;
          color:var(--v-accent);
          pointer-events:none;
        }
        .vd-gallery-play svg { width:36px;height:36px; }

        /* "Ver todas (+N)" overlay on the last tile when the total count
           exceeds the mobile cap (4). Sits over the tile content but still
           lets the wrapper click through (pointer-events:none + parent
           click). */
        .vd-gallery-more-overlay {
          position:absolute;inset:0;
          background:rgba(8,8,8,0.72);
          -webkit-backdrop-filter:blur(2px);
          backdrop-filter:blur(2px);
          display:flex;flex-direction:column;
          align-items:center;justify-content:center;
          color:var(--v-accent);
          z-index:3;
          pointer-events:none;
        }
        .vd-gallery-more-plus {
          font-family:'Cormorant Garamond','Playfair Display',serif;
          font-weight:500;font-size:28px;
          line-height:1;
        }
        .vd-gallery-more-label {
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:10px;font-weight:500;
          letter-spacing:.14em;text-transform:uppercase;
          margin-top:6px;
          color:var(--v-text-primary);
        }

        /* Hero flex: always column, centered */
        .vd-hero {
          display:flex;flex-direction:column;align-items:center;text-align:center;gap:24px;
        }
        .vd-hero-info { align-items:center!important; }
        .vd-tags { justify-content:center!important; }

        /* Circle sizes — bumped to 210px (was 180/120 with a mobile shrink).
           The hero profile photo stays large at every breakpoint, not just
           desktop. No shrink media query — 210px fits viewports >= 320px
           (16px padding each side + 210px = 242px). */
        .vd-avatar {
          width:210px;height:210px;border-radius:50%;flex-shrink:0;
          /* Centre the fixed-width avatar: the mobile hero is display:block
             (.vd-hero-mobile overrides .vd-hero's flex), so align-items has no
             effect and a block child would otherwise left-align. */
          margin-left:auto;margin-right:auto;
          overflow:hidden;border:1px solid rgba(var(--brand-primary-rgb),0.25);
          /* Neutral photo-glyph placeholder behind the avatar while the
             Cloudinary cover-photo loads — matches the photo-grid skeleton
             pattern. Light surface so it reads as a subtle empty panel; the
             photo uses a g_face crop so it rarely peeks through. */
          background:var(--v-bg-elevated) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20'/%3E%3C/svg%3E") center/56px no-repeat;
        }

        /* Story ring */
        @keyframes vdStoryRing {
          0%  { background-position: 0% 50% }
          50% { background-position: 100% 50% }
          100%{ background-position: 0% 50% }
        }
        .vd-story-ring-wrap {
          position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; flex-shrink: 0;
        }
        .vd-story-ring {
          border-radius: 50%; padding: 4px; cursor: pointer;
          background: conic-gradient(from 140deg,var(--v-accent-light),var(--v-accent),#9a7a3a,var(--v-accent-light),var(--v-accent),#9a7a3a,var(--v-accent-light));
          background-size: 200% 200%;
          animation: vdStoryRing 4s ease infinite;
          transition: transform .3s ease, filter .3s ease;
          box-shadow: 0 0 18px rgba(var(--brand-primary-rgb),0.25), 0 0 40px rgba(var(--brand-primary-rgb),0.12);
        }
        .vd-story-ring:hover { transform: scale(1.04); filter: brightness(1.1); }
        .vd-story-ring-seen {
          border-radius: 50%; padding: 4px; cursor: pointer;
          background: var(--v-border);
          transition: transform .3s ease, filter .3s ease;
        }
        .vd-story-ring-seen:hover { transform: scale(1.04); filter: brightness(1.1); }
        .vd-story-ring-inner {
          border-radius: 50%; overflow: hidden;
          /* Light surface — the avatar photo fills this circle; the elevated
             tone reads as a subtle empty panel if the photo doesn't fully
             cover, matching the rest of the light page. */
          background: var(--v-bg-elevated);
          display: flex; align-items: center; justify-content: center;
        }
        .vd-story-label {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif; font-size: 11px; font-weight: 400;
          letter-spacing:.2em; text-transform: uppercase; color: var(--v-accent-strong);
        }

        /* Story overlay */
        .vd-story-overlay {
          position: fixed; inset: 0; z-index: 9500; background: #000;
          display: flex; align-items: center; justify-content: center; overflow: hidden;
          /* Same reason as .vd-lightbox: full-screen media is always dark;
             color-scheme:dark avoids the white UA canvas frame in light. */
          color-scheme: dark;
        }

        /* Story ring no longer shrinks on mobile — the avatar is 210px at
           every breakpoint (with or without active stories), so the profile
           photo stays prominent. The component's inline style sets 216/210
           (ring + inner) consistent with the bumped .vd-avatar. */

        /* Verified badge */
        .v-verified-badge{display:inline-flex;align-items:center;color:var(--v-accent);font-size:60%;vertical-align:middle;margin-left:8px;cursor:default;position:relative;}
        .v-verified-badge::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:var(--v-bg-card);border:1px solid rgba(var(--brand-primary-rgb),0.2);color:var(--v-accent-strong);font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:7px;font-weight:400;letter-spacing:.14em;white-space:nowrap;padding:4px 10px;border-radius:6px;opacity:0;pointer-events:none;transition:opacity .3s ease;}
        .v-verified-badge:hover::after{opacity:1}

        /* Section headings — Cormorant Garamond, accent uppercase, tracking
           .16em, font-size 15px. Replaces the legacy Switzer 17px (more
           editorial, truer to the mockup). */
        .vd-field-label {
          font-family:'Cormorant Garamond','Playfair Display',serif;
          font-size:15px;font-weight:500;
          letter-spacing:.16em;text-transform:uppercase;
          color:var(--v-accent-strong);
          display:block;margin-bottom:10px;
        }
        /* Secondary pill next to the title */
        .vd-field-label-count {
          display:inline-block;
          margin-left:8px;
          background:rgba(var(--brand-primary-rgb),0.08);
          color:var(--v-accent-strong);
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-weight:500;
          font-size:10px;letter-spacing:0;text-transform:none;
          padding:2px 8px;
          border:1px solid rgba(var(--brand-primary-rgb),0.18);
          border-radius:999px;
          vertical-align:middle;
        }

        /* Lightbox */
        .vd-lightbox {
          position:fixed;inset:0;z-index:9000;
          background:rgba(0,0,0,0.92);
          display:flex;align-items:center;justify-content:center;
          padding:20px;
          animation:fadeUp .3s ease forwards;
          /* The lightbox is ALWAYS dark (backdrop hardcoded). Forcing
             color-scheme:dark here neutralizes a side effect of the global
             color-scheme:light (light theme, admin): Chrome paints a LIGHT
             canvas behind the object-fit:contain <img> → a white frame
             around the photo (visible on dark photos). With dark, that canvas
             is dark = invisible over the backdrop. It doesn't alter the
             photo's colors, only the UA render of the backdrop. */
          color-scheme: dark;
        }
        .vd-lightbox img {
          max-width:100%;max-height:90vh;
          object-fit:contain;border-radius:6px;
        }
        .vd-lightbox-close {
          position:fixed;top:20px;right:20px;
          background:transparent;border:1px solid var(--v-accent);
          width:36px;height:36px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;color:var(--v-accent);font-size:18px;font-weight:400;
          transition:background .2s ease;
        }
        .vd-lightbox-close:hover { background:rgba(var(--brand-primary-rgb),0.1); }

        /* ═══ RESPONSIVE VISIBILITY ═══
           Dedicated CSS media queries instead of Tailwind hidden md:*.
           On desktop BOTH heros (mobile + desktop) were showing mixed
           together — the Tailwind classes weren't applying correctly here.
           Direct CSS queries are reliable. */
        .vd-hero-mobile { display: block; }
        .vd-hero-desktop { display: none; }
        .vd-mobile-only { display: block; }
        .vd-sticky-cta.vd-mobile-only { display: block; }
        .vd-desktop-only { display: none; }
        @media (min-width: 768px) {
          .vd-hero-mobile { display: none; }
          .vd-hero-desktop { display: block; }
          .vd-mobile-only { display: none !important; }
          .vd-desktop-only { display: block; }
          .vd-content-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-bottom: 56px; }
        }

        /* Two-col content layout (services + attributes), desktop only. h3
           with a faint accent border-bottom; flat ungrouped chips (on mobile
           the 3 attribute cards stay separate via the mobile-only block).
           Languages inject as accent chips inside the desktop attributes
           column — they used to live in their own section. */
        .vd-content-section-h3 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 18px;
          color: var(--v-accent-strong);
          letter-spacing: .18em; text-transform: uppercase;
          margin: 0 0 18px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(var(--brand-primary-rgb),0.08);
        }
        .vd-chips-flat { display: flex; flex-wrap: wrap; gap: 8px; }
        .vd-chips-flat .vd-chip {
          font-size: 12.5px;
          padding: 7px 14px 6px;
          background: var(--v-bg-card);
        }
        .vd-chip-accent {
          color: var(--v-accent-strong) !important;
          background: rgba(var(--brand-primary-rgb),0.08) !important;
          border-color: rgba(var(--brand-primary-rgb),0.32) !important;
        }
        .vd-content-note {
          font-size: 11.5px; color: var(--v-text-tertiary);
          margin-top: 14px; font-weight: 400;
        }

        /* ═══ HERO DESKTOP ═══
           Blurred cover bg + overlay gradient removed in favor of a flat
           black background. The .vd-hero-desktop-bg and
           .vd-hero-desktop-overlay divs stay hidden via display:none — the
           JSX still renders but isn't shown. Base background =
           var(--v-bg-base) (black). */
        .vd-hero-desktop {
          position: relative;
          overflow: hidden;
          margin: 0 -56px;
          padding: 40px 56px 56px;
          margin-bottom: 0;
          background: var(--v-bg-base);
        }
        .vd-hero-desktop-bg,
        .vd-hero-desktop-overlay { display: none; }
        .vd-hero-desktop-inner {
          position: relative; z-index: 2;
          max-width: 1280px; margin: 0 auto;
          display: grid;
          grid-template-columns: 380px 1fr;
          gap: 56px;
          align-items: center;
        }
        .vd-hero-desktop-profile {
          display: flex; flex-direction: column; align-items: center;
          gap: 16px;
        }
        .vd-hero-desktop-circle {
          width: 380px; height: 380px;
          border-radius: 50%;
          padding: 4px;
          background: linear-gradient(135deg,var(--v-accent) 0%,var(--v-accent-light) 50%,var(--v-accent) 100%);
          cursor: pointer;
          position: relative;
          transition: transform 0.3s ease;
        }
        .vd-hero-desktop-circle.no-stories { cursor: default; }
        .vd-hero-desktop-circle:hover { transform: scale(1.02); }
        .vd-hero-desktop-circle.seen {
          background: var(--v-border);
        }
        .vd-hero-desktop-circle-inner {
          position: relative;
          width: 100%; height: 100%;
          border-radius: 50%;
          overflow: hidden;
          /* Light border + neutral photo-glyph placeholder, matching
             .vd-avatar / .vd-story-ring-inner. The avatar photo fills the
             circle; the elevated surface reads as a subtle empty panel. */
          border: 4px solid var(--v-bg-base);
          background: var(--v-bg-elevated) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20'/%3E%3C/svg%3E") center/96px no-repeat;
          display: flex; align-items: center; justify-content: center;
        }
        .vd-hero-desktop-info { color: var(--v-text-primary); }
        .vd-hero-desktop-tier-pill {
          display: inline-block;
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 11px;
          letter-spacing: .2em; text-transform: uppercase;
          padding: 5px 12px 4px;
          border-radius: 3px;
          margin-bottom: 16px;
        }
        .vd-hero-desktop-name-row {
          display: flex; align-items: center; gap: 14px;
          margin-bottom: 22px;
        }
        .vd-hero-desktop-name {
          font-family: 'Playfair Display','Cormorant Garamond',serif;
          font-weight: 500; font-size: 64px;
          color: var(--v-text-primary); line-height: 1;
          margin: 0;
        }
        .vd-hero-desktop-verif {
          width: 32px !important; height: 32px !important;
          object-fit: contain;
          flex-shrink: 0;
        }
        .vd-hero-desktop-info-row {
          display: grid;
          gap: 24px;
          margin-bottom: 22px;
        }
        .vd-hero-desktop-info-row .ic {
          color: var(--v-accent);
          margin-bottom: 6px;
        }
        .vd-hero-desktop-info-row .ic svg { width: 16px; height: 16px; }
        .vd-hero-desktop-info-row .lbl {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 13px; color: var(--v-text-primary);
          font-weight: 500; line-height: 1.3;
        }
        .vd-hero-desktop-info-row .sub {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11px; color: var(--v-text-tertiary);
          margin-top: 3px; font-weight: 400;
        }
        .vd-hero-desktop-info-row .price {
          font-family: 'Playfair Display','Cormorant Garamond',serif;
          font-weight: 500; font-size: 18px;
          color: var(--v-text-primary); line-height: 1.2;
        }
        .vd-hero-desktop-info-row .price-old {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11px; color: var(--v-text-tertiary);
          text-decoration: line-through;
          margin-top: 2px;
        }
        .vd-hero-desktop-tags {
          display: flex; flex-wrap: wrap; gap: 22px; row-gap: 8px;
          padding: 12px 0;
          border-top: 1px solid rgba(var(--brand-primary-rgb),0.22);
          border-bottom: 1px solid rgba(var(--brand-primary-rgb),0.22);
          margin-bottom: 18px;
        }
        .vd-hero-desktop-tag-text {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; font-weight: 500;
          letter-spacing: .16em; text-transform: uppercase;
          color: var(--v-text-primary);
        }
        .vd-hero-desktop-tag-sep {
          color: var(--v-accent);
          font-weight: 500;
          font-size: 14px;
          line-height: 1;
        }
        .vd-hero-desktop-description {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 14px; color: var(--v-text-primary);
          line-height: 1.7;
          font-weight: 400;
          max-width: 800px;
          margin: 0;
        }

        /* ═══ ACTION BAR DESKTOP — full-width strip, 4 buttons ═══
           Display: none by default, 4-col grid ≥768px. */
        .vd-action-bar {
          display: none;
          margin: 0 -56px 40px;
          grid-template-columns: repeat(4, 1fr);
          background: var(--v-bg-base);
          border-top: 1px solid rgba(var(--brand-primary-rgb),0.08);
          border-bottom: 1px solid rgba(var(--brand-primary-rgb),0.08);
        }
        @media (min-width: 768px) {
          .vd-action-bar { display: grid; }
        }
        .vd-action-btn {
          padding: 22px 24px;
          display: flex; align-items: center; justify-content: center; gap: 12px;
          color: var(--v-text-primary);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 13px; font-weight: 500;
          letter-spacing: .08em; text-transform: uppercase;
          border-right: 1px solid rgba(var(--brand-primary-rgb),0.08);
          background: transparent;
          text-decoration: none;
          transition: background .2s ease, color .2s ease;
          cursor: pointer;
          border-top: none; border-bottom: none; border-left: none;
        }
        .vd-action-btn:last-child { border-right: 0; }
        .vd-action-btn:hover {
          background: rgba(var(--brand-primary-rgb),0.05);
          color: var(--v-accent-strong);
        }
        .vd-action-btn .ic {
          width: 36px; height: 36px;
          border-radius: 50%;
          border: 1px solid rgba(var(--brand-primary-rgb),0.32);
          display: flex; align-items: center; justify-content: center;
          color: var(--v-accent);
          flex-shrink: 0;
          transition: background .2s ease, color .2s ease, border-color .2s ease;
        }
        .vd-action-btn .ic svg { width: 15px; height: 15px; }
        .vd-action-btn.cta {
          background: rgba(var(--brand-primary-rgb),0.08);
          color: var(--v-accent-strong);
        }
        .vd-action-btn.cta:hover {
          background: var(--v-accent);
          color: var(--v-text-inverse);
        }
        .vd-action-btn.cta:hover .ic {
          background: var(--v-text-inverse);
          color: var(--v-accent);
          border-color: var(--v-text-inverse);
        }

        /* Hero tags inline — items separated by a centered · accent.
           The ::before CSS approach left the · stuck to the item on its
           right. Now the · is a separate JSX node inside the flex with gap
           12px — the spacing applies symmetrically on both sides, visually
           centered. */
        .vd-hero-tags-inline {
          display: flex; flex-wrap: wrap; justify-content: center;
          gap: 12px; row-gap: 6px;
          padding-top: 14px;
          border-top: 1px solid rgba(var(--brand-primary-rgb),0.22);
          width: 100%;
        }
        .vd-tag-text {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11px; font-weight: 500;
          letter-spacing: .14em;
          color: var(--v-text-primary);
        }
        .vd-tag-sep {
          color: var(--v-accent);
          font-weight: 500;
          font-size: 14px;
          line-height: 1;
        }

        /* Attribute cards (Cuerpo / Apariencia / Hábitos). Replaces the
           legacy flat flex-wrap with 3 semantically grouped cards. Same
           visual style as loc-card. */
        .vd-attr-group {
          background:var(--v-bg-card);
          border:1px solid rgba(var(--brand-primary-rgb),0.08);
          border-radius:10px;
          padding:14px 14px 12px;
          margin-bottom:8px;
        }
        .vd-attr-group:last-child { margin-bottom:0; }
        .vd-attr-group h4 {
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:10px;font-weight:500;
          color:var(--v-text-tertiary);
          letter-spacing:.18em;text-transform:uppercase;
          margin:0 0 10px 0;
        }
        .vd-attr-chips { display:flex;flex-wrap:wrap;gap:5px; }
        .vd-chip {
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:11.5px;font-weight:400;letter-spacing:.005em;
          padding:5px 11px 4px;
          border:1px solid rgba(var(--brand-primary-rgb),0.18);
          color:var(--v-text-primary);
          border-radius:999px;
          background:transparent;
        }

        /* Location card — 3 structured rows with a circular accent-border
           icon, uppercase muted label, cream value. Replaces the legacy
           flex-wrap with 📍🕐 emojis. */
        .vd-loc-card {
          background:var(--v-bg-card);
          border:1px solid rgba(var(--brand-primary-rgb),0.08);
          border-radius:10px;
          padding:14px 16px;
          display:flex;flex-direction:column;gap:10px;
        }
        .vd-loc-row {
          display:flex;align-items:center;gap:12px;
          padding:6px 0;
        }
        .vd-loc-row + .vd-loc-row { border-top:1px solid rgba(var(--brand-primary-rgb),0.08); }
        .vd-loc-icon {
          width:26px;height:26px;border-radius:50%;
          border:1px solid rgba(var(--brand-primary-rgb),0.25);
          display:flex;align-items:center;justify-content:center;
          color:var(--v-accent);flex-shrink:0;
        }
        .vd-loc-icon svg { width:12px;height:12px; }
        .vd-loc-body { flex:1;min-width:0; }
        .vd-loc-label {
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:9.5px;font-weight:500;
          color:var(--v-text-tertiary);
          letter-spacing:.16em;text-transform:uppercase;
        }
        .vd-loc-value {
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:13px;font-weight:400;
          color:var(--v-text-primary);
          margin-top:2px;
        }
      `}</style>

      {lightboxIndex !== null && (
        <GalleryLightbox
          items={galleryItems}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {storyOpen && postStories.length > 0 && (
        <PostStoryViewer
          stories={postStories}
          postTitle={post.title ?? ''}
          coverImage={post.profile_photo_url ?? (post.image_urls || [])[0] ?? null}
          tier={post.tier ?? null}
          onClose={closeStoryViewer}
        />
      )}

      <main style={{ minHeight: '100vh', background: 'var(--v-bg-base)', color: 'var(--v-text-primary)' }}>

        <style>{`
          .vd-main-wrap {
            max-width: 900px;
            margin: 0 auto;
            padding: 72px 24px 40px;
          }
          .vd-main-wrap.is-logged-in {
            padding-top: 120px;
          }
          @media (min-width: 768px) {
            .vd-main-wrap {
              max-width: 1280px;
              padding-left: 56px;
              padding-right: 56px;
            }
          }
        `}</style>
        <div className={`vd-main-wrap${userId ? ' is-logged-in' : ''}`}>

          <div className="vd-hero vd-hero-mobile vd-fade" style={{ animationDelay: '.1s', marginBottom: '36px' }}>

            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
              {tierDef && tierStyle && (
                <span style={{ fontFamily: "'Cormorant Garamond','Playfair Display',serif", fontSize: '10px', fontWeight: 500, letterSpacing: '.2em', textTransform: 'uppercase', color: tierStyle.color, background: tierStyle.background, border: tierStyle.border, padding: '4px 11px 3px', borderRadius: '3px' }}>
                  {tierDef.label}
                </span>
              )}
              {post.status === 'revision' && (
                <span style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '10px', fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--v-accent-strong)', background: 'rgba(var(--brand-primary-rgb),0.08)', border: '1px solid rgba(var(--brand-primary-rgb),0.2)', padding: '4px 11px 3px', borderRadius: '999px' }}>
                  {t(lang, 'pd_auditing')}
                </span>
              )}
            </div>

            {postStories.length > 0 ? (
              <div className="vd-story-ring-wrap">
                <div
                  className={storiesSeen ? 'vd-story-ring-seen' : 'vd-story-ring'}
                  onClick={() => setStoryOpen(true)}
                  style={{ width: '216px', height: '216px' }}
                >
                  <div className="vd-story-ring-inner" style={{ width: '210px', height: '210px', position: 'relative' }}>
                    {circleImg ? (
                      <Image src={circleImg} alt={post.title ?? 'Marketplace'} fill sizes="210px" style={{ objectFit: 'cover' }} priority />
                    ) : (
                      <span style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '52px', fontWeight:400, color: 'var(--v-text-tertiary)' , fontVariantNumeric: 'tabular-nums' }}>
                        {post.title?.[0] ?? 'V'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="vd-avatar" style={{ position: 'relative', width: '210px', height: '210px' }}>
                {circleImg ? (
                  <Image src={circleImg} alt={post.title ?? 'Marketplace'} fill sizes="210px" style={{ objectFit: 'cover' }} priority />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--v-bg-elevated)' }}>
                    <span style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '52px', fontWeight:400, color: 'var(--v-text-tertiary)' , fontVariantNumeric: 'tabular-nums' }}>
                      {post.title?.[0] ?? 'V'}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="vd-hero-info" style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>

              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {(() => {
                  const scheduleStatus = isWithinSchedule(post)
                  const available = scheduleStatus !== null ? scheduleStatus : true
                  return (
                    <h1 style={{
                      fontFamily: "'Playfair Display','Cormorant Garamond',serif",
                      fontSize: 'clamp(32px,5vw,42px)', fontWeight: 500,
                      letterSpacing: '-.005em', lineHeight: 1.15, color: 'var(--v-text-primary)',
                      margin: 0, textAlign: 'center',
                    fontVariantNumeric: 'tabular-nums' }}>
                      {/* Availability dot + verified flow inline with the centred
                          title (block flow, not inline-flex) so the dot sits next
                          to the name instead of pinned far-left when the title
                          wraps to two lines. */}
                      <span
                        aria-label={available ? t(lang, 'pd_available') : t(lang, 'pd_unavailable')}
                        style={{ display: 'inline-block', verticalAlign: 'middle', width: '11px', height: '11px', borderRadius: '50%',
                          marginRight: '10px', transform: 'translateY(-2px)',
                          background: available ? 'var(--v-success)' : 'var(--v-text-tertiary)',
                          boxShadow: available ? '0 0 0 3px rgba(106,176,106,0.20)' : 'none' }}
                      />
                      {post.title}
                      {KYC_ON && post.identity_verified && post.tier !== 'basic' && (
                        <Image src="/images/verificado.png" alt="Verificado" width={24} height={24} style={{ display: 'inline-block', verticalAlign: 'middle', width: '0.7em', height: '0.7em', objectFit: 'contain', marginLeft: '8px', transform: 'translateY(-0.04em)' }} />
                      )}
                    </h1>
                  )
                })()}
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
                {post.is_promoted && post.promo_price ? (
                  <>
                    <p style={{
                      fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
                      fontSize: 'clamp(32px,4.5vw,44px)', fontWeight:400, color: 'var(--v-accent-strong)', letterSpacing: '-.01em',
                      margin: 0,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {formatPrice(post.promo_price)}
                    </p>
                    <span style={{
                      fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
                      fontSize: 'clamp(18px,2.4vw,22px)', fontWeight:400,
                      color: 'var(--v-text-tertiary)', textDecoration: 'line-through',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {priceDisplay}
                    </span>
                    <span style={{ alignSelf: 'center', fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px', fontWeight: 500, letterSpacing: '.14em', textTransform: 'uppercase', color: '#d4954c', background: 'rgba(212,149,76,0.15)', border: '1px solid rgba(212,149,76,0.3)', padding: '3px 8px', borderRadius: '3px', whiteSpace: 'nowrap' }}>
                      {t(lang, 'pd_promo')}
                    </span>
                  </>
                ) : (
                  <p style={{
                    fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
                    fontSize: 'clamp(32px,4.5vw,44px)', fontWeight:400, color: 'var(--v-accent)', letterSpacing: '-.01em',
                    margin: 0,
                  fontVariantNumeric: 'tabular-nums' }}>
                    {priceDisplay}
                  </p>
                )}
              </div>

              {(() => {
                const tagsArr: string[] = []
                if (post.localidad) tagsArr.push(((post.localidad || '').split(',')[0]?.trim() || countrySlug).toUpperCase())
                if (catDef)         tagsArr.push(tOption(lang, catDef.label).toUpperCase())
                if (tagsArr.length === 0) return null
                return (
                  <div className="vd-hero-tags-inline">
                    {tagsArr.map((tagText, idx) => (
                      <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
                        {idx > 0 && <span className="vd-tag-sep" aria-hidden="true">·</span>}
                        <span className="vd-tag-text">{tagText}</span>
                      </span>
                    ))}
                  </div>
                )
              })()}

              {post.is_promoted && post.promo_price && promoDays !== null && promoDays > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <span style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '10px', fontWeight: 400, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--v-text-secondary)' }}>
                    {t(lang, promoDays === 1 ? 'pd_promo_valid_one' : 'pd_promo_valid', { n: String(promoDays) })}
                  </span>
                </div>
              )}

            </div>
          </div>

          <section className="vd-fade vd-hero-desktop" style={{ animationDelay: '.1s' }}>
            {coverImg && (
              <div className="vd-hero-desktop-bg" style={{ backgroundImage: `url('${coverImg}')` }} />
            )}
            <div className="vd-hero-desktop-overlay" />
            <div className="vd-hero-desktop-inner">

              <div className="vd-hero-desktop-profile">
                {postStories.length > 0 ? (
                  <div
                    className={`vd-hero-desktop-circle${storiesSeen ? ' seen' : ''}`}
                    onClick={() => setStoryOpen(true)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="vd-hero-desktop-circle-inner">
                      {circleImg ? (
                        <Image src={circleImg} alt={post.title ?? 'Marketplace'} fill sizes="380px" style={{ objectFit: 'cover' }} priority />
                      ) : (
                        <span style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '88px', fontWeight:400, color: 'var(--v-text-tertiary)' }}>
                          {post.title?.[0] ?? 'V'}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="vd-hero-desktop-circle no-stories">
                    <div className="vd-hero-desktop-circle-inner">
                      {circleImg ? (
                        <Image src={circleImg} alt={post.title ?? 'Marketplace'} fill sizes="380px" style={{ objectFit: 'cover' }} priority />
                      ) : (
                        <span style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '88px', fontWeight:400, color: 'var(--v-text-tertiary)' }}>
                          {post.title?.[0] ?? 'V'}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="vd-hero-desktop-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {tierDef && tierStyle && (
                    <span className="vd-hero-desktop-tier-pill" style={{ color: tierStyle.color, background: tierStyle.background, border: tierStyle.border, marginBottom: 0 }}>
                      {tierDef.label}
                    </span>
                  )}
                </div>

                <div className="vd-hero-desktop-name-row">
                  {(() => {
                    const scheduleStatus = isWithinSchedule(post)
                    const available = scheduleStatus !== null ? scheduleStatus : true
                    return (
                      <span
                        aria-label={available ? t(lang, 'pd_available') : t(lang, 'pd_unavailable')}
                        style={{ width: '13px', height: '13px', borderRadius: '50%', flexShrink: 0,
                          background: available ? 'var(--v-success)' : 'var(--v-text-tertiary)',
                          boxShadow: available ? '0 0 0 3px rgba(106,176,106,0.20)' : 'none' }}
                      />
                    )
                  })()}
                  <h1 className="vd-hero-desktop-name">{post.title}</h1>
                  {KYC_ON && post.identity_verified && post.tier !== 'basic' && (
                    <Image src="/images/verificado.png" alt="Verificado" width={32} height={32} className="vd-hero-desktop-verif" />
                  )}
                </div>

                {(() => {
                  type Cell = { icon: React.ReactNode; label: string; sub?: string; isPrice?: boolean; priceOld?: string }
                  const cells: Cell[] = []
                  if (post.is_promoted && post.promo_price) {
                    cells.push({
                      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
                      label: formatPrice(post.promo_price),
                      priceOld: priceDisplay,
                      isPrice: true,
                    })
                  } else if (priceDisplay) {
                    cells.push({
                      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
                      label: priceDisplay,
                      isPrice: true,
                    })
                  }
                  if (post.localidad) {
                    const parts = post.localidad.split(',').map(p => p.trim()).filter(Boolean)
                    cells.push({
                      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>,
                      label: parts[0] ?? '',
                      sub: parts.slice(1).join(', ') || undefined,
                    })
                  }
                  if (cells.length === 0) return null
                  return (
                    <div className="vd-hero-desktop-info-row" style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)` }}>
                      {cells.map((c, i) => (
                        <div key={i}>
                          <div className="ic">{c.icon}</div>
                          {c.isPrice ? (
                            <>
                              <div className="price">{c.label}</div>
                              {c.priceOld && <div className="price-old">{c.priceOld}</div>}
                            </>
                          ) : (
                            <>
                              <div className="lbl">{c.label}</div>
                              {c.sub && <div className="sub">{c.sub}</div>}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })()}

                {(() => {
                  const tagsArr: string[] = []
                  for (const attr of getAttributeGroups().flatMap(g => g.attributes)) {
                    if (attr.type === 'multiselect') continue
                    if (!hasAttributeValue(post.attributes, attr)) continue
                    tagsArr.push(formatAttributeValue(attr, post.attributes?.[attr.key]))
                  }
                  if (tagsArr.length === 0) return null
                  return (
                    <div className="vd-hero-desktop-tags">
                      {tagsArr.map((tagText, idx) => (
                        <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '22px' }}>
                          {idx > 0 && <span className="vd-hero-desktop-tag-sep" aria-hidden="true">·</span>}
                          <span className="vd-hero-desktop-tag-text">{tagText}</span>
                        </span>
                      ))}
                    </div>
                  )
                })()}

                {post.description && (
                  <p className="vd-hero-desktop-description">{post.description}</p>
                )}
              </div>
            </div>
          </section>

          <div className="vd-action-bar vd-fade" style={{ animationDelay: '.15s' }}>
            {contactPhone ? (
              <div className="vd-action-btn">
                <span className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                </span>
                +{contactPhone.replace(/^(\d+)/, (s: string) => s.slice(0, 2) + ' ' + s.slice(2))}
              </div>
            ) : (
              <div className="vd-action-btn" style={{ color: 'var(--v-text-tertiary)' }}>
                <span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></span>
                {t(lang, 'contact_unavailable')}
              </div>
            )}
            {contactPhone ? (
              <a
                href={`https://wa.me/${contactPhone}?text=Hola%20${encodeURIComponent(post.title ?? '')},%20vi%20tu%20anuncio%20en%20Marketplace%2B%20y%20me%20gustar%C3%ADa%20contactarte.`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent(id, 'whatsapp_click', undefined, userId ?? undefined)}
                className="vd-action-btn cta"
              >
                <span className="ic">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                </span>
                WhatsApp
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => { document.getElementById('vd-experiencias')?.scrollIntoView({ behavior: 'smooth' }) }}
              className="vd-action-btn"
            >
              <span className="ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
              </span>
              {t(lang, 'pd_experiencias')}
            </button>
            <button
              type="button"
              onClick={async () => {
                const url = typeof window !== 'undefined' ? window.location.href : ''
                if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                  try { await navigator.share({ title: post.title ?? '', url }); return } catch { /* fallback */ }
                }
                try { await navigator.clipboard.writeText(url) } catch { /* noop */ }
              }}
              className="vd-action-btn"
            >
              <span className="ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>
              </span>
              {t(lang, 'pd_share')}
            </button>
          </div>

          {/* Listing attributes (desktop) — config-driven
              (src/config/attributes.config.ts). One block per attribute group;
              multiselect values render as chips, scalars as "label: value". */}
          {(() => {
            const groups = getAttributeGroups()
              .map(g => ({ ...g, attributes: g.attributes.filter(a => hasAttributeValue(post.attributes, a)) }))
              .filter(g => g.attributes.length > 0)
            if (groups.length === 0) return null
            return (
              <section className="vd-desktop-only vd-content-two-col vd-fade" style={{ animationDelay: '.2s' }}>
                {groups.map(({ group, attributes }) => (
                  <div key={group}>
                    <h3 className="vd-content-section-h3">{group}</h3>
                    <div className="vd-chips-flat">
                      {attributes.flatMap(attr => {
                        const raw = post.attributes?.[attr.key]
                        if (Array.isArray(raw)) {
                          return raw.map(v => <span key={`${attr.key}-${v}`} className="vd-chip">{tOption(lang, String(v))}</span>)
                        }
                        return [<span key={attr.key} className="vd-chip">{attr.label}: {formatAttributeValue(attr, raw)}</span>]
                      })}
                    </div>
                  </div>
                ))}
              </section>
            )
          })()}

          <div className="vd-divider vd-mobile-only" />

          <div className="vd-fade" style={{ animationDelay: '.2s' }}>
            {post.audio_url && (
              <div style={{ marginBottom: '28px', padding: '20px', background: 'var(--v-bg-elevated)', borderRadius: '6px', border: '1px solid rgba(var(--brand-primary-rgb),0.1)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: '2px', height: '100%', background: 'var(--v-accent)' }} />
                <p className="vd-field-label" style={{ marginLeft: '12px', marginBottom: '14px' }}>
                  {t(lang, 'pd_voice_msg')}
                </p>
                <audio controls style={{ width: '100%', height: '32px', opacity: .6, filter: 'invert(1) grayscale(1)', marginLeft: '12px' }}>
                  <source src={post.audio_url} />
                </audio>
              </div>
            )}

            {post.description && (
              <div className="vd-mobile-only">
                <p className="vd-field-label">{t(lang, 'pd_description')}</p>
                <div style={{ position: 'relative' }}>
                  <style>{`
                    .vd-desc-scroll::-webkit-scrollbar{width:3px}
                    .vd-desc-scroll::-webkit-scrollbar-track{background:transparent}
                    .vd-desc-scroll::-webkit-scrollbar-thumb{background:rgba(var(--brand-primary-rgb),0.3);border-radius:6px}
                  `}</style>
                  <p
                    ref={descRef}
                    className="vd-desc-scroll"
                    style={{
                      fontFamily:"'Switzer','Inter','Helvetica Neue',Arial,sans-serif",fontSize:'15px',fontWeight:400,
                      color:'var(--v-text-secondary)',lineHeight:1.85,whiteSpace:'pre-wrap',
                      maxHeight:'220px',overflowY:'auto',paddingBottom:'32px',margin:0,
                    }}
                  >
                    {post.description}
                  </p>
                  {descOverflow && (
                    <div style={{
                      position:'absolute',bottom:0,left:0,right:0,height:'48px',
                      background:'linear-gradient(to bottom,transparent,var(--v-bg-base))',
                      pointerEvents:'none',
                    }} />
                  )}
                </div>
              </div>
            )}
          </div>

          {Boolean((post.price_usd && (post.price || post.price_eur)) || post.price_eur) && (
            <>
              <div className="vd-divider" />
              <div className="vd-fade" style={{ animationDelay: '.28s' }}>
                <p className="vd-section-title">{t(lang, 'pd_alt_payments')}</p>
                <div className="vd-chips-flat">
                  {post.price_usd && post.price ? (
                    <span className="vd-chip vd-chip-accent">
                      {currencySymbol}{post.price.toLocaleString(DISPLAY_LOCALE)} {post.currency || MARKET_CURRENCY}
                    </span>
                  ) : null}
                  {post.price_eur ? (
                    <span className="vd-chip vd-chip-accent">
                      €{post.price_eur.toLocaleString(DISPLAY_LOCALE)} EUR
                    </span>
                  ) : null}
                </div>
              </div>
            </>
          )}

          {galleryItems.length > 0 && (() => {
            const VISIBLE_MOBILE = 4
            const photoCount = galleryImages.length
            const videoCount = videos.length
            const ctParts: string[] = []
            if (photoCount > 0) ctParts.push(`${photoCount} ${photoCount === 1 ? t(lang, 'pd_photo_single') : t(lang, 'pd_photos').toLowerCase()}`)
            if (videoCount > 0) ctParts.push(`${videoCount} ${videoCount === 1 ? t(lang, 'pd_video_single') : t(lang, 'pd_videos').toLowerCase()}`)
            const ctLabel = ctParts.join(' · ')

            const overflowCount = Math.max(0, galleryItems.length - VISIBLE_MOBILE)
            return (
              <>
                <div className="vd-divider" />
                <div className="vd-fade" style={{ animationDelay: '.3s' }}>
                  <p className="vd-section-title">
                    {t(lang, 'pd_gallery')}
                    {ctLabel && <span className="vd-field-label-count">{ctLabel}</span>}
                  </p>
                  <div className="vd-gallery-grid">
                    {galleryItems.map((item, i) => {
                      const isMobileOverflowTile = i === VISIBLE_MOBILE - 1 && overflowCount > 0
                      const isHiddenOnMobile = i >= VISIBLE_MOBILE
                      const onOpen = () => { setLightboxIndex(i); trackEvent(id, 'photo_click', i) }
                      return (
                        <div
                          key={i}
                          className={`vd-gallery-item${isHiddenOnMobile ? ' vd-gallery-item-mobile-hidden' : ''}${isMobileOverflowTile ? ' vd-gallery-item-more' : ''}`}
                          onClick={onOpen}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onOpen() }}
                        >
                          {item.type === 'video' ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={item.poster}
                                alt=""
                                loading={i < 2 ? 'eager' : 'lazy'}
                                decoding="async"
                              />
                              <span className="vd-gallery-video-tag">Video</span>
                              <span className="vd-gallery-play">
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                  <circle cx="12" cy="12" r="11" fill="rgba(8,8,8,0.55)" stroke="currentColor" strokeWidth="1.5"/>
                                  <polygon points="10,8 16,12 10,16" fill="currentColor"/>
                                </svg>
                              </span>
                            </>
                          ) : (
                            <ProtectedImage
                              src={item.url}
                              alt=""
                              loading={i < 2 ? 'eager' : 'lazy'}
                              decoding="async"
                            />
                          )}
                          {isMobileOverflowTile && (
                            <span className="vd-gallery-more-overlay">
                              <span className="vd-gallery-more-plus">+{overflowCount}</span>
                              <span className="vd-gallery-more-label">{t(lang, 'pd_view_all')}</span>
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )
          })()}

          <div className="vd-divider" />
          <div className="vd-fade" style={{ animationDelay: '.4s' }}>

            {/* Listing attributes (mobile) — config-driven. One labelled
                block per attribute group; multiselect values render as chips,
                scalar values as "label: value". Retargeting the vertical
                (src/config/attributes.config.ts) swaps the whole section. */}
            {(() => {
              const groups = getAttributeGroups()
                .map(g => ({ ...g, attributes: g.attributes.filter(a => hasAttributeValue(post.attributes, a)) }))
                .filter(g => g.attributes.length > 0)
              if (groups.length === 0) return null
              return groups.map(({ group, attributes }) => (
                <div key={group} className="vd-mobile-only" style={{ marginBottom: '24px' }}>
                  <p className="vd-field-label">{group}</p>
                  <div className="vd-attr-chips">
                    {attributes.flatMap(attr => {
                      const raw = post.attributes?.[attr.key]
                      if (Array.isArray(raw)) {
                        return raw.map(v => <span key={`${attr.key}-${v}`} className="vd-chip">{tOption(lang, String(v))}</span>)
                      }
                      return [<span key={attr.key} className="vd-chip">{attr.label}: {formatAttributeValue(attr, raw)}</span>]
                    })}
                  </div>
                </div>
              ))
            })()}

            {/* Logistics — listing location (zona). The generic model keeps
                only `localidad` as a core geo field; vertical-specific
                logistics (schedule, premises) now live in the config-driven
                attributes rendered above. */}
            {post.localidad && (
              <div className="vd-mobile-only" style={{ marginBottom: '24px' }}>
                <p className="vd-field-label">{t(lang, 'pd_location_schedule')}</p>
                <div className="vd-loc-card">
                  <div className="vd-loc-row">
                    <span className="vd-loc-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
                        <circle cx="12" cy="9" r="2.5" />
                      </svg>
                    </span>
                    <div className="vd-loc-body">
                      <div className="vd-loc-label">Zona</div>
                      <div className="vd-loc-value">{post.localidad}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}


            <style>{`
              .vd-contact-cta-row {
                margin-top: 32px;
                display: none;
                flex-direction: column;
                gap: 12px;
                align-items: stretch;
              }
              .vd-contact-cta {
                width: 100%;
              }
              @media (min-width: 768px) {
                .vd-contact-cta-row { display: flex; align-items: center; }
                .vd-contact-cta {
                  width: auto;
                  min-width: 260px;
                  max-width: 320px;
                  padding-top: 12px !important;
                  padding-bottom: 12px !important;
                }
              }
            `}</style>
            <div className="vd-contact-cta-row">
              {contactPhone ? (
                <a
                  className="vd-contact-cta"
                  href={`https://wa.me/${contactPhone}?text=Hola%20${encodeURIComponent(post.title ?? '')},%20vi%20tu%20anuncio%20en%20Marketplace%2B%20y%20me%20gustar%C3%ADa%20contactarte.`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackEvent(id, 'whatsapp_click', undefined, userId ?? undefined)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: 'var(--v-accent)', color: 'var(--v-bg-base)', padding: '18px', borderRadius: '6px', border: 'none', cursor: 'pointer', textDecoration: 'none', fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: 'clamp(13px,2.5vw,16px)', fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', transition: 'background .4s ease', whiteSpace: 'nowrap' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--v-accent-light)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--v-accent)'}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--v-bg-base)" style={{ flexShrink: 0 }}>
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  <span>{t(lang, 'contact_btn')}</span>
                </a>
              ) : (
                <button disabled className="vd-contact-cta" style={{ background: 'var(--v-bg-elevated)', color: 'var(--v-text-disabled)', padding: '18px', borderRadius: '6px', border: '1px solid var(--v-border)', cursor: 'not-allowed', fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: 'clamp(13px,2.5vw,16px)', fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {t(lang, 'contact_unavailable')}
                </button>
              )}

              {contactTelegram && (
                <a
                  className="vd-contact-cta"
                  href={`https://t.me/+${contactTelegram}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackEvent(id, 'telegram_click', undefined, userId ?? undefined)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: 'var(--v-accent)', color: 'var(--v-bg-base)', padding: '18px', borderRadius: '6px', border: 'none', cursor: 'pointer', textDecoration: 'none', fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: 'clamp(13px,2.5vw,16px)', fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', transition: 'background .4s ease', whiteSpace: 'nowrap' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--v-accent-light)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--v-accent)'}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--v-bg-base)" style={{ flexShrink: 0 }}>
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                  </svg>
                  <span>{t(lang, 'contact_btn')}</span>
                </a>
              )}
            </div>

            <div style={{ textAlign: 'center', marginTop: '20px' }}>
              <button
                onClick={() => setReportOpen(true)}
                style={{
                  background: 'rgba(204,0,0,0.06)',
                  border: '1px solid rgba(204,0,0,0.35)',
                  cursor: 'pointer',
                  fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
                  fontSize: '12px',
                  fontWeight: 500,
                  letterSpacing: '.2em',
                  textTransform: 'uppercase',
                  color: 'var(--v-error)',
                  padding: '10px 22px',
                  borderRadius: '6px',
                  transition: 'background .2s ease, border-color .2s ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement
                  el.style.background = 'rgba(204,0,0,0.12)'
                  el.style.borderColor = 'rgba(204,0,0,0.6)'
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement
                  el.style.background = 'rgba(204,0,0,0.06)'
                  el.style.borderColor = 'rgba(204,0,0,0.35)'
                }}
              >
                <span aria-hidden="true">⚠️</span>
                {t(lang, 'pd_report')}
              </button>
            </div>

            {/* ── Related listings ──
                Free-scroll horizontal rail. Card style: photo on top
                (aspect 1/1.2) + info below in a white block (not an overlay).
                Tier badge top-right, Playfair name with age + verified mini,
                location row with an accent pin, accent price. No chevrons or
                edge-auto-scroll — the rail works with native swipe on mobile
                and trackpad/shift+wheel on desktop, plus grab-to-drag with a
                mouse + infinite loop (useCarouselRail), since a bare mouse
                can't scroll a horizontal overflow-x. */}
            {recommendations.length > 0 && (
              <div style={{ marginTop: '48px', paddingTop: '28px', borderTop: '1px solid rgba(var(--brand-primary-rgb),0.08)' }}>
                <p className="vd-section-title">
                  {t(lang, 'pd_also_interesting')}
                </p>
                <style>{`
                  .vd-rec-rail {
                    display: flex; gap: 10px;
                    overflow-x: auto;
                    /* No scroll-snap: the rail scrolls freely so a mouse drag
                       (useCarouselRail) moves it continuously and can rest
                       with a card half-visible, instead of jumping whole-card
                       to whole-card. scroll-behavior:auto keeps each drag
                       scrollLeft write instant (the global html smooth would
                       otherwise animate them and lag the drag). */
                    scroll-snap-type: none;
                    scroll-behavior: auto;
                    -webkit-overflow-scrolling: touch;
                    scrollbar-width: none;
                    /* Grab affordance + no text/image selection while dragging
                       with a mouse. */
                    cursor: grab;
                    user-select: none;
                    -webkit-user-select: none;
                    padding: 4px 0 8px;
                    margin: 0 -16px;
                    padding-left: 16px;
                    padding-right: 16px;
                  }
                  .vd-rec-rail:active { cursor: grabbing; }
                  .vd-rec-rail::-webkit-scrollbar { display: none; }
                  /* Disable the browser's native image/link drag on the cards.
                     Without this a mouse-press on a card's photo/anchor starts
                     a native drag-and-drop, which fires pointercancel and
                     kills the grab-to-scroll before it moves. -webkit-user-drag
                     covers Chrome/Safari; the draggable={false} attrs on the
                     Link/Image cover Firefox. */
                  .vd-rec-rail a, .vd-rec-rail img {
                    -webkit-user-drag: none;
                    user-drag: none;
                  }
                  /* Desktop: STILL a free-scroll horizontal rail (not a grid)
                     — a carousel at ALL breakpoints. Cards grow in width with
                     the viewport, showing 4 visible at md+. */
                  @media(min-width:768px) {
                    .vd-rec-rail { gap: 14px; margin: 0; padding-left: 0; padding-right: 0; }
                  }
                  .vd-rec-card{
                    position: relative;
                    flex: 0 0 calc(50% - 5px); /* 2 cards visible mobile */
                    display: flex; flex-direction: column;
                    background: var(--v-bg-elevated);
                    border: 1px solid rgba(var(--brand-primary-rgb),0.08);
                    border-radius: 8px;
                    overflow: hidden;
                    text-decoration: none;
                    transition: border-color .3s ease;
                  }
                  @media(min-width:480px) { .vd-rec-card { flex: 0 0 calc(33.33% - 7px); } }
                  @media(min-width:768px) { .vd-rec-card { flex: 0 0 calc(25% - 11px); } }
                  .vd-rec-card:hover { border-color: rgba(var(--brand-primary-rgb),0.25); }
                  .vd-rec-card:hover .vd-rec-name { color: var(--v-accent); }
                  .vd-rec-ph {
                    position: relative;
                    aspect-ratio: 1 / 1.618;
                    overflow: hidden;
                    background: var(--v-bg-elevated) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20'/%3E%3C/svg%3E") center/48px no-repeat;
                  }
                  .vd-rec-gradient {
                    position: absolute; inset: 0;
                    pointer-events: none;
                    background: linear-gradient(180deg,
                      rgba(8,8,8,0.45) 0%,
                      transparent 22%,
                      transparent 50%,
                      rgba(8,8,8,0.88) 100%);
                  }
                  .vd-rec-ovl-bottom {
                    position: absolute;
                    bottom: 9px; left: 10px; right: 10px;
                    z-index: 2;
                  }
                  .vd-rec-tier {
                    position: absolute;
                    top: 8px; right: 8px; z-index: 2;
                    background: rgba(8,8,8,0.7);
                    -webkit-backdrop-filter: blur(4px);
                    backdrop-filter: blur(4px);
                    color: var(--v-accent);
                    font-family: 'Cormorant Garamond','Playfair Display',serif;
                    font-weight: 500; font-size: 9px;
                    letter-spacing: .16em; text-transform: uppercase;
                    padding: 3px 7px;
                    border: 1px solid rgba(37, 99, 235,0.32);
                    border-radius: 3px;
                  }
                  .vd-rec-tier.elite {
                    color: var(--v-bg-base);
                    background: linear-gradient(135deg,#93C5FD,var(--v-accent));
                    border-color: transparent;
                  }
                  .vd-rec-promo {
                    position: absolute;
                    top: 8px; left: 8px; z-index: 2;
                    background: rgba(8,8,8,0.7);
                    -webkit-backdrop-filter: blur(4px);
                    backdrop-filter: blur(4px);
                    color: #80e080;
                    font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
                    font-weight: 500; font-size: 9px;
                    letter-spacing: .14em; text-transform: uppercase;
                    padding: 3px 7px;
                    border: 1px solid rgba(128,224,128,0.45);
                    border-radius: 3px;
                  }
                  .vd-rec-name {
                    font-family: 'Playfair Display','Cormorant Garamond',serif;
                    font-weight: 500; font-size: 14px;
                    color: #FFFFFF;
                    display: flex; align-items: center; gap: 6px;
                    transition: color .3s ease;
                    line-height: 1.1;
                    text-shadow: 0 1px 4px rgba(0,0,0,0.85);
                  }
                  .vd-rec-dot {
                    width: 7px; height: 7px;
                    border-radius: 50%;
                    flex-shrink: 0;
                  }
                  .vd-rec-dot.on {
                    background: #6ab06a;
                    box-shadow: 0 0 0 2px rgba(106,176,106,0.22);
                  }
                  .vd-rec-dot.off { background: rgba(255,255,255,0.35); }
                  .vd-rec-age {
                    color: rgba(255,255,255,0.7);
                    font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
                    font-size: 11px; font-weight: 400;
                    letter-spacing: 0;
                  }
                  .vd-rec-verif { width: 12px; height: 12px; flex-shrink: 0; }
                  .vd-rec-loc {
                    display: inline-block;
                    margin-top: 6px;
                    background: rgba(0,0,0,0.55);
                    border: 1px solid rgba(37, 99, 235,0.4);
                    border-radius: 6px;
                    padding: 3px 8px;
                    color: #fff;
                    font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
                    font-size: 9px; font-weight: 400;
                    letter-spacing: .02em;
                    max-width: 100%;
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                    box-sizing: border-box;
                  }
                  .vd-rec-price {
                    color: #fff;
                    font-family: 'Playfair Display','Cormorant Garamond',serif;
                    font-weight: 600; font-size: 15px;
                    margin-top: 3px;
                    font-variant-numeric: tabular-nums;
                    text-shadow: 0 1px 4px rgba(0,0,0,0.85);
                  }
                  .vd-rec-price-old {
                    color: rgba(255,255,255,0.55);
                    font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
                    font-size: 11px;
                    text-decoration: line-through;
                    margin-left: 6px;
                    font-variant-numeric: tabular-nums;
                    text-shadow: 0 1px 3px rgba(0,0,0,0.85);
                  }
                `}</style>
                <div className="vd-rec-rail" ref={recRailRef}>
                  {(recLoop
                    ? [...recommendations, ...recommendations, ...recommendations]
                    : recommendations
                  ).map((rec, recIdx) => {
                    // Route through getCloudinaryUrl so the recommendation
                    // carousel thumbs pick up the Marketplace overlay + tier-
                    // appropriate crop.
                    const recImg = rec.image_urls?.[0]
                      ? getCloudinaryUrl(rec.image_urls[0], rec.tier ?? 'basic')
                      : null
                    const recPrice = rec.price_usd ? `${Math.round(rec.price_usd).toLocaleString('en-US')} USD` : (rec.currency === 'BRL' ? `R$${rec.price?.toLocaleString(DISPLAY_LOCALE)}` : `$${rec.price?.toLocaleString(DISPLAY_LOCALE)}`)
                    const recPromoPriceStr = rec.is_promoted && rec.promo_price
                      ? `${Math.round(rec.promo_price).toLocaleString('en-US')} USD`
                      : null
                    const recCountry = Array.isArray(rec.countries) ? rec.countries[0] : rec.countries
                    const recLoc = (rec.localidad || '').split(',')[0]?.trim() || recCountry?.name || ''
                    const isElite = rec.tier === 'elite'
                    const recSchedule = isWithinSchedule(rec)
                    const recAvailable = recSchedule !== null ? recSchedule : true
                    return (
                      <Link
                        key={`${rec.id}-${recIdx}`}
                        href={postCanonicalPath(rec)}
                        className="vd-rec-card"
                        draggable={false}
                      >
                        <div className="vd-rec-ph">
                          {recImg ? (
                            <Image src={recImg} alt={rec.title ?? 'Marketplace'} fill draggable={false} sizes="(max-width:480px) 50vw, (max-width:768px) 33vw, 25vw" style={{ objectFit: 'cover' }} />
                          ) : null}
                          <div className="vd-rec-gradient" />
                          {rec.is_promoted && rec.promo_price && <span className="vd-rec-promo">Promo</span>}
                          {rec.tier && (
                            <span className={`vd-rec-tier${isElite ? ' elite' : ''}`}>{isElite ? 'Elite' : rec.tier}</span>
                          )}
                          <div className="vd-rec-ovl-bottom">
                            <div className="vd-rec-name">
                              <span className={`vd-rec-dot ${recAvailable ? 'on' : 'off'}`} />
                              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec.title}</span>
                              {KYC_ON && rec.identity_verified && (
                                <Image src="/images/verificado.png" alt="" width={12} height={12} className="vd-rec-verif" />
                              )}
                            </div>
                            {recLoc && (
                              <div className="vd-rec-loc">{recLoc}</div>
                            )}
                            <div className="vd-rec-price">
                              {recPromoPriceStr ?? recPrice}
                              {recPromoPriceStr && <span className="vd-rec-price-old">{recPrice}</span>}
                            </div>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}

          </div>

          {reportOpen && (
            <ReportModal
              postId={id}
              onClose={() => setReportOpen(false)}
              presetCategory={reportPresetCategory}
            />
          )}

          {/* Use post.id (real UUID) — the URL `id` param can be a name-slug
              ('felicitas') which fails the reviews.post_id FK constraint. */}
          {REVIEWS_ENABLED && post?.id && (
            <div id="vd-experiencias" style={{ scrollMarginTop: '90px' }}>
              <PostExperiencias postId={post.id} postTier={post.tier} />
            </div>
          )}

        </div>

        <div className="vd-sticky-cta vd-mobile-only fixed left-0 right-0 bottom-0 z-50 px-4 pt-6 pb-6" style={{
          background: 'linear-gradient(180deg, rgba(var(--v-bg-base-rgb),0) 0%, rgba(var(--v-bg-base-rgb),0.92) 30%, rgba(var(--v-bg-base-rgb),0.98) 100%)',
        }}>
          {/* Heart · (Telegram) · Contactar, all 56px tall. pb-6 puts them in
              the same [24px,80px] band as the fixed chat FAB; pr-[84px]
              reserves the FAB corner so the flex-1 pill never sits under it —
              the three buttons + the chat icon read as one aligned row. */}
          <div className="flex gap-2 items-center max-w-[640px] mx-auto pr-[84px]">
            <button
              type="button"
              onClick={() => { setStickyFav(prev => !prev); trackEvent(id, 'favorite') }}
              aria-label={stickyFav ? 'Quitar de favoritos' : 'Guardar en favoritos'}
              aria-pressed={stickyFav}
              className="w-14 h-14 flex-shrink-0 rounded-full flex items-center justify-center bg-[var(--v-bg-elevated)] border border-[rgba(var(--brand-primary-rgb),0.32)] text-[var(--v-accent)] hover:border-[rgba(var(--brand-primary-rgb),0.6)] transition-colors"
            >
              <svg viewBox="0 0 24 24" fill={stickyFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                <path d="M12 21s-7-4.5-9-9C1 8 4 4 8 4c2 0 3.5 1 4 2.5C12.5 5 14 4 16 4c4 0 7 4 5 8-2 4.5-9 9-9 9z" />
              </svg>
            </button>
            {contactTelegram && (
              <a
                href={`https://t.me/+${contactTelegram}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent(id, 'telegram_click', undefined, userId ?? undefined)}
                aria-label="Contactar por Telegram"
                className="w-14 h-14 flex-shrink-0 rounded-full flex items-center justify-center bg-[var(--v-accent)] hover:bg-[var(--v-accent-light)] text-[var(--v-bg-base)] no-underline transition-colors"
              >
                {/* paper-plane glyph only (no roundel — a roundel filled with the
                    button colour would paint the plane in negative). */}
                <svg width="20" height="20" viewBox="0 0 448 512" fill="currentColor" className="flex-shrink-0" aria-hidden="true">
                  <path d="M446.7 98.6l-67.6 318.8c-5.1 22.5-18.4 28.1-37.3 17.5l-103-75.9-49.7 47.8c-5.5 5.5-10.1 10.1-20.7 10.1l7.4-104.9 190.9-172.5c8.3-7.4-1.8-11.5-12.9-4.1L117.8 284 16.2 252.2c-22.1-6.9-22.5-22.1 4.6-32.7L418.2 66.4c18.4-6.9 34.5 4.1 28.5 32.2z" />
                </svg>
              </a>
            )}
            {contactPhone ? (
              <a
                href={`https://wa.me/${contactPhone}?text=Hola%20${encodeURIComponent(post.title ?? '')},%20vi%20tu%20anuncio%20en%20Marketplace%2B%20y%20me%20gustar%C3%ADa%20contactarte.`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent(id, 'whatsapp_click', undefined, userId ?? undefined)}
                className="flex-1 h-14 inline-flex items-center justify-center gap-2.5 px-5 bg-[var(--v-accent)] hover:bg-[var(--v-accent-light)] text-[var(--v-bg-base)] rounded-full font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] font-semibold text-[13px] tracking-[.14em] uppercase no-underline transition-colors"
                aria-label="Contactar anunciante"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                {t(lang, 'contact_btn_short')}
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="flex-1 h-14 inline-flex items-center justify-center gap-2.5 px-5 bg-[var(--v-bg-elevated)] text-[var(--v-text-disabled)] rounded-full border border-[var(--v-border)] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] font-semibold text-[13px] tracking-[.14em] uppercase cursor-not-allowed"
              >
                {t(lang, 'contact_unavailable')}
              </button>
            )}
          </div>
        </div>
      </main>

    </>
  )
}
