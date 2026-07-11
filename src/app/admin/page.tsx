'use client'
import { supabase } from '@/lib/supabase/client'
import { getUserId } from '@/lib/supabase/direct'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import MarketplaceWordmark from '@/components/MarketplaceWordmark'
import ThemeModeSwitch from '@/components/ThemeModeSwitch'
import { COUNTRY_LABEL, STORIES_ENABLED, REVIEWS_ENABLED } from '@/config/marketplace.config'
import AdminReviews from '@/components/admin/AdminReviews'
import AdminReports from '@/components/admin/AdminReports'
import AdminStories from '@/components/admin/AdminStories'
import AdminVerifications from '@/components/admin/AdminVerifications'
import AdminPublications from '@/components/admin/AdminPublications'
import AdminGeo from '@/components/admin/AdminGeo'
import AdminTierSettings from '@/components/admin/AdminTierSettings'
import AdminQueue from '@/components/admin/AdminQueue'
import AdminActivity from '@/components/admin/AdminActivity'
import AdminPerformers, { type PerformerSummary } from '@/components/admin/AdminPerformers'
import AdminContentQueue from '@/components/admin/AdminContentQueue'
import { useMarketplaceDialog } from '@/components/ui/MarketplaceDialog'
import { kycEnabled } from '@/lib/kyc'
import type {
  AdminCategory,
  AdminCountry,
  AdminPost,
  AdminReport,
  AdminReview,
  AdminStoryRow,
  AdminVerification,
  CityCategorySetting,
  SupportMessage,
  SupportThread,
} from '@/lib/types/admin'

const MONO = { fontFamily: "'Montserrat',sans-serif" } as const

// Whether the verification module is enabled for this deployment (FEATURE_KYC).
// Gates the admin Verifications queue + section end-to-end.
const KYC_ON = kycEnabled()
// Stories / Reviews are add-on features (FEATURE_STORIES / FEATURE_REVIEWS) —
// off in the marketplace base. Gate their admin moderation queues + sections.
const STORIES_ON = STORIES_ENABLED
const REVIEWS_ON = REVIEWS_ENABLED

export default function AdminPanel() {
  const [posts, setPosts]   = useState<AdminPost[]>([])
  const [profileMap, setProfileMap] = useState<Record<string, { credits: number; email: string | null }>>({})
  const [stats, setStats]   = useState({ pendingAction: 0, totalPosts: 0 })
  const [loading, setLoading] = useState(true)
  const [notification, setNotification] = useState<{ text: string, type: 'success' | 'error' } | null>(null)
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null)
  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  // Per-section fetch errors. Collected during `checkAdminAndFetchData`
  // and surfaced via a dismissable banner at the top of the dashboard,
  // so transient Supabase failures stop silently zero-ing out queues
  // (stories / reviews / geo / city-category toggles) without any
  // visible signal that the data is stale.
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({})
  const dlg = useMarketplaceDialog()

  const [pendingReports, setPendingReports]       = useState<AdminReport[]>([])

  // Stories moderation — list + setter live here; preview/reject UI state
  // is owned by <AdminStories/>.
  const [pendingStories, setPendingStories]       = useState<AdminStoryRow[]>([])

  // `cities` state holds rows from the `countries` table; the name is kept
  // for minimal churn with legacy references. AdminGeo below handles
  // provincia/comuna/barrio management.
  const [cities, setCities] = useState<AdminCountry[]>([])

  // Identity verification queue — reject UI state lives inside <AdminVerifications/>.
  const [pendingVerifications, setPendingVerifications] = useState<AdminVerification[]>([])

  // 2257 review queue — fed by /api/admin/performers (service-role). The
  // <AdminContentQueue/> below self-fetches its own list, so it needs no state here.
  const [pendingPerformers, setPendingPerformers] = useState<PerformerSummary[]>([])

  const [pendingReviews, setPendingReviews] = useState<AdminReview[]>([])

  const [supportThreads, setSupportThreads] = useState<SupportThread[]>([])
  const [selectedChatUser, setSelectedChatUser] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<SupportMessage[]>([])
  const [chatReply, setChatReply] = useState('')

  const [dynamicCategories, setDynamicCategories] = useState<AdminCategory[]>([])
  const [showCatModal, setShowCatModal] = useState(false)
  const [newCat, setNewCat] = useState({ name: '', slug: '', active: true })

  const [cityCatSettings, setCityCatSettings] = useState<CityCategorySetting[]>([])
  const [visibilityCity, setVisibilityCity] = useState('')

  const router = useRouter()

  // React Compiler rejects the usual hoisted-function pattern for effects
  // (flags "Cannot access variable before it is declared"). `checkAdminAndFetchData`
  // only runs from this mount-once effect, so moving the body here as a
  // cancelable IIFE keeps the function hoisting-safe without duplicating a
  // 130-line handler. fetchSupportThreads is declared below and invoked
  // from inside the IIFE; it's also used by later handlers so it stays
  // as a separate function.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!cancelled) await checkAdminAndFetchData()
    })()

    // Re-fetch on browser back/forward nav. Without this, clicking
    // Editar → /admin/edit → browser Back returns the user to /admin
    // with the stale empty state from the prior race (the mount fetch
    // hit the well-known transient "no-user" window during middleware
    // cookie refresh, so state arrays were all empty). Next.js App
    // Router restores the page from its client cache without
    // re-mounting, so the mount-time effect never re-runs — we need
    // our own back-nav hook.
    //
    // `pageshow` fires on bfcache restores (`persisted: true`);
    // `popstate` fires on history back/forward within the SPA. Both
    // bounce back into `checkAdminAndFetchData`. The function itself
    // is idempotent — setState calls just overwrite — so a double-run
    // is harmless if both fire.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && !cancelled) checkAdminAndFetchData()
    }
    const onPopState = () => {
      if (!cancelled) checkAdminAndFetchData()
    }
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('popstate', onPopState)

    return () => {
      cancelled = true
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('popstate', onPopState)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkAdminAndFetchData() {
    // Auth can be in a transient "no user" state while the middleware is
    // rewriting the refresh cookie (arriving from /admin/edit/<id> triggers
    // this reliably). Fall back to getSession() so we don't bounce a logged-in
    // admin to /ingresar mid-navigation. Third fallback: read the user id
    // directly from the auth cookie — the SDK's in-memory state can lag
    // behind the cookie after a back-nav re-mount, but the cookie itself
    // is the server's source of truth and parseable synchronously.
    let { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      const { data: { session } } = await supabase.auth.getSession()
      user = session?.user ?? null
    }
    let userId = user?.id ?? null
    if (!userId) {
      userId = getUserId()
      if (userId) {
        console.warn('[admin] SDK getUser/getSession both returned null but cookie has a valid session — proceeding with cookie userId.')
      }
    }
    if (!userId) return router.push('/ingresar')

    setCurrentAdminId(userId)
    setAdminEmail(user?.email ?? null)

    // If the profile fetch fails transiently, don't bounce to '/'. Retry once.
    let { data: profile, error: profileErr } = await supabase
      .from('profiles').select('is_admin').eq('id', userId).single()
    if (profileErr) {
      await new Promise(r => setTimeout(r, 250))
      const retry = await supabase.from('profiles').select('is_admin').eq('id', userId).single()
      profile = retry.data
      profileErr = retry.error
    }
    if (profileErr || !profile?.is_admin) return router.push('/')

    // Collect errors as we go; surfaced in the banner at the top of the
    // dashboard after the function finishes. Starts empty on every run
    // so a prior failure clears once a retry succeeds.
    const errors: Record<string, string> = {}

    const postsRes = await supabase
      .from('posts')
      .select('*, countries(slug,name), provincias(slug,name), comunas(slug,name), barrios(slug,name)')
      .order('created_at', { ascending: false })
    if (postsRes.error) {
      errors.publicaciones = `Publicaciones: ${postsRes.error.message}`
    } else if (postsRes.data) {
      setPosts(postsRes.data)
      setStats({
        pendingAction: postsRes.data.filter(p => p.status === 'pending' || p.status === 'revision').length,
        totalPosts: postsRes.data.length,
      })

      const userIds = [...new Set(postsRes.data.map(p => p.user_id).filter(Boolean))]
      if (userIds.length > 0) {
        const profilesRes = await supabase
          .from('profiles')
          .select('id, credits, email')
          .in('id', userIds)
        if (profilesRes.error) {
          errors.autores = `Perfiles de autores: ${profilesRes.error.message}`
        } else if (profilesRes.data) {
          // Runtime validation: drop any row with a non-string id instead
          // of indexing into the map with `undefined` (which would mask a
          // schema drift / regression in the select). Dropped rows are
          // logged so we notice them in Sentry if they accumulate.
          const map: Record<string, { credits: number; email: string | null }> = {}
          let dropped = 0
          for (const p of profilesRes.data) {
            if (!p || typeof p.id !== 'string') { dropped++; continue }
            map[p.id] = {
              credits: typeof p.credits === 'number' ? p.credits : 0,
              email:   typeof p.email === 'string' ? p.email : null,
            }
          }
          if (dropped > 0) console.warn(`[admin] profileMap: ${dropped} row(s) dropped (missing id / malformed)`)
          setProfileMap(map)
        }
      }
    }
    // Fetch pending stories with post info for grouping. Skipped when the
    // Stories add-on is off (FEATURE_STORIES) — the base strips the table, so
    // querying it would error.
    const storiesRes = STORIES_ON
      ? await supabase
          .from('stories')
          .select('*')
          .eq('status', 'pending')
          .order('post_id', { ascending: true })
          .order('created_at', { ascending: true })
      : { data: [] as AdminStoryRow[], error: null }
    if (storiesRes.error) {
      errors.historias = `Historias pendientes: ${storiesRes.error.message}`
    }

    // Manually join post title/city and user email since foreign key joins may fail
    let storiesWithContext = storiesRes.data || []
    if (storiesRes.data && storiesRes.data.length > 0) {
      const postIds = [...new Set(storiesRes.data.map(s => s.post_id).filter(Boolean))]
      const userIds = [...new Set(storiesRes.data.map(s => s.user_id).filter(Boolean))]
      const [storyPosts, storyProfiles] = await Promise.all([
        postIds.length > 0
          ? supabase.from('posts').select('id, title, localidad, countries(slug,name)').in('id', postIds)
          : Promise.resolve({ data: [], error: null as unknown as null }),
        userIds.length > 0
          ? supabase.from('profiles').select('id, email').in('id', userIds)
          : Promise.resolve({ data: [], error: null as unknown as null }),
      ])
      // Surface join failures separately from the top-level fetch — if
      // only the post-join fails the stories list still renders, just
      // without post titles, and the admin sees WHICH join is sick.
      if (storyPosts.error) errors.historiasPosts = `Historias · posts: ${storyPosts.error.message}`
      if (storyProfiles.error) errors.historiasProfiles = `Historias · perfiles: ${storyProfiles.error.message}`
      const postMap    = new Map((storyPosts.data || []).map(p => [p.id, p]))
      const profileMap = new Map((storyProfiles.data || []).map(p => [p.id, p]))
      storiesWithContext = storiesRes.data.map(s => ({
        ...s,
        posts: postMap.get(s.post_id) || null,
        profiles: profileMap.get(s.user_id) || null,
      }))
    }
    setPendingStories(storiesWithContext)

    const reportsRes = await supabase
      .from('reports')
      .select('*, posts(title, image_urls, localidad, countries(slug,name))')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    if (reportsRes.error) errors.reportes = `Reportes: ${reportsRes.error.message}`
    setPendingReports(reportsRes.data || [])

    const citiesRes = await supabase
      .from('countries')
      .select('id, slug, name, active')
      .order('sort_order')
    if (citiesRes.error) errors.paises = `Países: ${citiesRes.error.message}`
    setCities(citiesRes.data || [])

    const verificationsRes = await supabase
      .from('profiles')
      .select('id, full_name, email, identity_doc_url, identity_selfie_url, identity_video_url, verification_status, created_at')
      .eq('verification_status', 'pending')
      .order('created_at', { ascending: true })
    if (verificationsRes.error) errors.verificaciones = `Verificaciones: ${verificationsRes.error.message}`
    setPendingVerifications(verificationsRes.data || [])

    // Fetch pending reviews — same manual-join pattern as stories, because
    // the `posts` embedded join can silently drop rows when the PostgREST
    // relationship inference fails (intermittent in production).
    // Skipped when the Reviews add-on is off (FEATURE_REVIEWS) — the base strips
    // the table, so querying it would error.
    const reviewsRes = REVIEWS_ON
      ? await supabase
          .from('reviews')
          .select('id, rating, comment, reviewer_name, post_id, created_at')
          .eq('status', 'pending_admin')
          .order('created_at', { ascending: true })
      : { data: [] as AdminReview[], error: null }
    if (reviewsRes.error) errors.resenas = `Reseñas: ${reviewsRes.error.message}`

    let reviewsWithContext = reviewsRes.data || []
    if (reviewsRes.data && reviewsRes.data.length > 0) {
      const reviewPostIds = [...new Set(reviewsRes.data.map(r => r.post_id).filter(Boolean))]
      if (reviewPostIds.length > 0) {
        const reviewPostsRes = await supabase.from('posts').select('id, title').in('id', reviewPostIds)
        if (reviewPostsRes.error) errors.resenasPosts = `Reseñas · posts: ${reviewPostsRes.error.message}`
        const reviewPostMap = new Map((reviewPostsRes.data || []).map(p => [p.id, p]))
        reviewsWithContext = reviewsRes.data.map(r => ({
          ...r,
          posts: reviewPostMap.get(r.post_id) || null,
        }))
      }
    }
    setPendingReviews(reviewsWithContext)

    await fetchSupportThreads()

    // 2257 review queue via the admin API (performers_2257 is RLS-scoped; the
    // route reads it with the service role). Non-fatal — surfaced separately.
    if (KYC_ON) {
      try {
        const perfRes = await fetch('/api/admin/performers')
        const perfData = await perfRes.json().catch(() => null)
        if (perfRes.ok && Array.isArray(perfData?.performers)) {
          setPendingPerformers(perfData.performers)
        } else if (!perfRes.ok) {
          errors.performers = `Registros 2257: ${perfData?.error ?? `HTTP ${perfRes.status}`}`
        }
      } catch (e) {
        errors.performers = `Registros 2257: ${e instanceof Error ? e.message : 'error de red'}`
      }
    }

    const catsRes = await supabase.from('categories').select('*').order('name')
    if (catsRes.error) errors.categorias = `Categorías: ${catsRes.error.message}`
    setDynamicCategories(catsRes.data || [])

    const ccRes = await supabase.from('city_category_settings').select('*')
    if (ccRes.error) errors.visibilidad = `Visibilidad país × categoría: ${ccRes.error.message}`
    setCityCatSettings(ccRes.data || [])

    setFetchErrors(errors)
    setLoading(false)
  }

  async function fetchSupportThreads() {
    const { data: allChats } = await supabase
      .from('support_chats')
      .select('user_id, message, sender, read, created_at, profiles(full_name, email)')
      .order('created_at', { ascending: false })

    if (allChats) {
      const threads: Record<string, SupportThread> = {}
      for (const msg of allChats) {
        // The embedded `profiles(full_name, email)` relation is typed loosely
        // by Supabase (object or array). Narrow it locally before reading.
        const prof = msg.profiles as { full_name?: string | null; email?: string } | { full_name?: string | null; email?: string }[] | null
        const profObj = Array.isArray(prof) ? prof[0] : prof
        if (!threads[msg.user_id]) {
          threads[msg.user_id] = {
            userId: msg.user_id,
            name: profObj?.full_name || profObj?.email || 'Usuario',
            lastMessage: msg.message,
            lastTime: msg.created_at,
            unread: 0,
          }
        }
        if (msg.sender === 'user' && !msg.read) threads[msg.user_id].unread++
      }
      setSupportThreads(Object.values(threads))
    }
  }

  async function loadChatMessages(userId: string) {
    setSelectedChatUser(userId)
    const { data } = await supabase
      .from('support_chats')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    setChatMessages(data || [])
    await supabase.from('support_chats')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('sender', 'user')
      .eq('read', false)
  }

  async function sendAdminReply() {
    if (!chatReply.trim() || !selectedChatUser) return
    const { data } = await supabase.from('support_chats').insert({
      user_id: selectedChatUser,
      message: chatReply.trim(),
      sender: 'admin',
    }).select().single()
    if (data) setChatMessages(prev => [...prev, data])
    setChatReply('')
  }

  function getCityCategoryVisible(citySlug: string, catSlug: string): boolean {
    const setting = cityCatSettings.find(s => s.city_slug === citySlug && s.category_slug === catSlug)
    return setting ? setting.visible : true
  }

  async function toggleCityCategory(citySlug: string, catSlug: string, visible: boolean) {
    await supabase.from('city_category_settings').upsert(
      { city_slug: citySlug, category_slug: catSlug, visible },
      { onConflict: 'city_slug,category_slug' }
    )
    const { data } = await supabase.from('city_category_settings').select('*')
    setCityCatSettings(data || [])
    showNotification(`${catSlug} ${visible ? 'visible' : 'oculta'} en ${citySlug}`, 'success')
  }

  async function toggleCategoryRow(catId: string, catSlug: string, currentActive: boolean) {
    const newActive = !currentActive
    await supabase.from('categories').update({ active: newActive }).eq('id', catId)
    const rows = cities.map(c => ({ city_slug: c.slug, category_slug: catSlug, visible: newActive }))
    if (rows.length > 0) {
      await supabase.from('city_category_settings').upsert(rows, { onConflict: 'city_slug,category_slug' })
    }
    const [{ data: cats }, { data: ccData }] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('city_category_settings').select('*'),
    ])
    setDynamicCategories(cats || [])
    setCityCatSettings(ccData || [])
    showNotification(`Categoría ${catSlug} ${newActive ? 'activada' : 'desactivada'} en todos los países`, 'success')
  }

  // `city_category_settings` keeps its original column name (city_slug) —
  // the value stored is now the country slug.
  async function toggleCountryColumn(cityId: string, citySlug: string, currentActive: boolean) {
    const newActive = !currentActive
    await supabase.from('countries').update({ active: newActive }).eq('id', cityId)
    const rows = dynamicCategories.map(cat => ({ city_slug: citySlug, category_slug: cat.slug, visible: newActive }))
    if (rows.length > 0) {
      await supabase.from('city_category_settings').upsert(rows, { onConflict: 'city_slug,category_slug' })
    }
    const [{ data: citiesData }, { data: ccData }] = await Promise.all([
      supabase.from('countries').select('id, slug, name, active').order('sort_order'),
      supabase.from('city_category_settings').select('*'),
    ])
    setCities(citiesData || [])
    setCityCatSettings(ccData || [])
    showNotification(`País ${citySlug} ${newActive ? 'activado' : 'desactivado'} con todas sus categorías`, 'success')
  }

  async function fetchCategories() {
    const { data } = await supabase.from('categories').select('*').order('name')
    setDynamicCategories(data || [])
  }

  async function toggleCategoryActive(id: string, active: boolean) {
    await supabase.from('categories').update({ active: !active }).eq('id', id)
    showNotification(active ? 'Categoría desactivada' : 'Categoría activada', 'success')
    fetchCategories()
  }

  async function deleteCategory(id: string, slug: string) {
    const { count } = await supabase.from('posts').select('id', { count: 'exact', head: true }).eq('category', slug)
    if (count && count > 0) {
      showNotification(`No se puede eliminar: ${count} anuncios en esta categoría`, 'error')
      return
    }
    await supabase.from('categories').delete().eq('id', id)
    showNotification('Categoría eliminada', 'success')
    fetchCategories()
  }

  async function createCategory() {
    if (!newCat.name || !newCat.slug) { showNotification('Completa todos los campos', 'error'); return }
    const { error } = await supabase.from('categories').insert({
      name: newCat.name,
      slug: newCat.slug.toLowerCase().replace(/[^a-z0-9]/g, ''),
      active: newCat.active,
    })
    if (error) { showNotification(error.message, 'error'); return }
    showNotification('Categoría creada', 'success')
    setNewCat({ name: '', slug: '', active: true })
    setShowCatModal(false)
    fetchCategories()
  }

  async function fetchVerifications() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, identity_doc_url, identity_selfie_url, identity_video_url, verification_status, created_at')
      .eq('verification_status', 'pending')
      .order('created_at', { ascending: true })
    setPendingVerifications(data || [])
  }

  async function fetchPerformers() {
    try {
      const res = await fetch('/api/admin/performers')
      const data = await res.json().catch(() => null)
      if (res.ok && Array.isArray(data?.performers)) setPendingPerformers(data.performers)
    } catch {
      // non-fatal: the 2257 queue just stays as-is until the next full refetch
    }
  }

  async function openDocument(path: string) {
    try {
      const res = await fetch(`/api/admin/identity-doc?path=${encodeURIComponent(path)}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        showNotification(body?.error || `No se pudo obtener la URL (HTTP ${res.status})`, 'error')
        return
      }
      if (typeof body?.url === 'string') window.open(body.url, '_blank')
      else showNotification('Respuesta inválida del servidor', 'error')
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Error de red al obtener la URL', 'error')
    }
  }

  const showNotification = (text: string, type: 'success' | 'error') => {
    setNotification({ text, type })
    setTimeout(() => setNotification(null), 4000)
  }

  return (
    <>
      {dlg.dialog}
      {/* Shared admin utility classes — still CSS-in-JSX because AdminPublications
          relies on v-post-row / v-admin-btn / v-action-btns-* for its row layout +
          mobile tweaks. Migrating these to Tailwind would require touching every
          consumer; keeping them centralised here (the admin page is their mount
          point) avoids that blast radius. */}
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        .v-fadein{opacity:1} /* concierge mode: no fade-in delay on logged-in pages */
        .d1{animation-delay:.1s}.d2{animation-delay:.25s}.d3{animation-delay:.35s}

        /* === Admin shell =================================================
           Fixed topnav + 240px sticky sidebar with anchor-links to the main
           sections. Replaces the local header (LogoLink + inline matrix +
           stats) that lived inside the max-w-[1200px] wrapper. */
        .adm-shell{
          min-height:100vh;
          background:var(--v-bg-base);
          color:var(--v-text-primary);
        }
        .adm-topnav{
          position:sticky;top:0;z-index:50;
          display:flex;justify-content:space-between;align-items:center;
          padding:14px 28px;
          border-bottom:1px solid rgba(37, 99, 235,0.12);
          background:rgba(255,255,255,0.92);
          color:#1a1a1a;
          backdrop-filter:blur(12px);
          -webkit-backdrop-filter:blur(12px);
        }
        .adm-topnav-left{display:flex;align-items:center;gap:12px;}
        .adm-brand-link{
          display:inline-flex;align-items:center;text-decoration:none;
        }
        .adm-brand-logo{
          height:36px;width:auto;object-fit:contain;opacity:.95;
        }
        .adm-country-chip{
          display:inline-flex;align-items:center;
          padding:5px 12px;
          border:1px solid rgba(37, 99, 235,0.25);
          border-radius:2px;
          color:rgba(0,0,0,0.7);
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:11px;font-weight:500;
          letter-spacing:0.22em;text-transform:uppercase;
        }
        .adm-admin-chip{
          display:inline-flex;align-items:center;gap:6px;
          padding:5px 11px 4px;
          background:rgba(37, 99, 235,0.08);
          border:1px solid rgba(37, 99, 235,0.18);
          border-radius:999px;
          color:#1D4ED8;
          font-family:'Montserrat',sans-serif;
          font-size:10.5px;font-weight:500;
          letter-spacing:0.16em;text-transform:uppercase;
        }
        .adm-topnav-right{display:flex;align-items:center;gap:12px;}
        .adm-theme-btn{
          display:inline-flex;align-items:center;justify-content:center;
          width:28px;height:28px;
          border-radius:999px;
          background:transparent;
          border:1px solid rgba(37, 99, 235,0.25);
          color:var(--v-accent);
          font-size:13px;line-height:1;
          cursor:pointer;
          transition:background .2s ease;
        }
        .adm-theme-btn:hover{background:rgba(37, 99, 235,0.08);}
        .adm-user-chip{
          display:inline-flex;align-items:center;gap:8px;
          color:#555;
          font-family:'Montserrat',sans-serif;
          font-size:11.5px;
          max-width:240px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        }
        .adm-user-chip .adm-avatar{
          flex-shrink:0;
          width:26px;height:26px;
          border-radius:50%;
          background:rgba(37, 99, 235,0.08);
          border:1px solid rgba(37, 99, 235,0.18);
          display:inline-flex;align-items:center;justify-content:center;
          color:#1D4ED8;
          font-family:'Cormorant Garamond',serif;font-weight:500;
          font-size:12px;
        }
        .adm-user-chip .adm-email{
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        }

        .adm-grid{
          display:grid;
          grid-template-columns:240px 1fr;
          min-height:calc(100vh - 57px);
        }
        .adm-sidebar{
          border-right:1px solid rgba(37, 99, 235,0.12);
          padding:22px 14px;
          background:#ffffff;
          position:sticky;
          top:57px;
          align-self:start;
          height:calc(100vh - 57px);
          overflow-y:auto;
        }
        .adm-group{margin-bottom:20px;}
        .adm-group-title{
          font-family:'Montserrat',sans-serif;
          font-size:9.5px;color:#7a7060;
          letter-spacing:0.2em;text-transform:uppercase;
          font-weight:500;
          padding:0 12px 8px;
        }
        .adm-item{
          display:flex;align-items:center;justify-content:space-between;
          padding:9px 12px;
          color:#1a1a1a;
          border-radius:6px;
          font-family:'Montserrat',sans-serif;
          font-size:12.5px;font-weight:400;
          letter-spacing:0.005em;
          gap:10px;
          text-decoration:none;
          cursor:pointer;
          border:1px solid transparent;
          background:transparent;
          width:100%;
          text-align:left;
        }
        .adm-item:hover{background:rgba(37, 99, 235,0.04);}
        .adm-item.adm-item-on{
          background:rgba(37, 99, 235,0.08);
          color:#1D4ED8;
          border-color:rgba(37, 99, 235,0.08);
        }
        .adm-item .adm-item-l{
          display:inline-flex;align-items:center;gap:10px;
          flex:1;min-width:0;
        }
        .adm-item .adm-item-l svg{
          width:14px;height:14px;
          color:var(--v-accent);
          flex-shrink:0;
        }
        .adm-item .adm-badge{
          background:rgba(37, 99, 235,0.08);
          color:#1D4ED8;
          border:1px solid rgba(37, 99, 235,0.18);
          padding:1px 7px;
          border-radius:999px;
          font-family:'Montserrat',sans-serif;
          font-size:10px;font-weight:500;
        }
        .adm-item .adm-badge-warn{
          background:rgba(212,149,76,0.12);
          color:#8a6310;
          border-color:rgba(212,149,76,0.28);
        }
        .adm-item .adm-badge-danger{
          background:rgba(199,90,90,0.1);
          color:#a02c2c;
          border-color:rgba(199,90,90,0.28);
        }

        .adm-main{
          padding:24px 32px 56px;
          max-width:1500px;
          width:100%;
        }
        .adm-page-head{
          display:flex;justify-content:space-between;align-items:flex-end;
          flex-wrap:wrap;
          gap:16px;
          padding-bottom:18px;
          border-bottom:1px solid rgba(37, 99, 235,0.08);
          margin-bottom:26px;
        }
        .adm-page-head h1{
          font-family:'Cormorant Garamond',serif;
          font-weight:500;
          font-size:30px;color:var(--v-text-primary);
          letter-spacing:0.005em;line-height:1;
        }
        .adm-page-head h1 em{
          font-family:'Cormorant Garamond',serif;
          font-style:normal;
          font-weight:400;font-size:0.5em;
          color:var(--v-accent);
          margin-left:14px;
        }
        .adm-page-actions{display:flex;gap:8px;flex-wrap:wrap;}
        .adm-btn{
          display:inline-flex;align-items:center;gap:7px;
          padding:9px 16px 8px;
          border:1px solid rgba(37, 99, 235,0.08);
          border-radius:999px;
          color:var(--v-text-primary);
          background:transparent;
          font-family:'Montserrat',sans-serif;
          font-size:11.5px;font-weight:500;
          letter-spacing:0.06em;
          cursor:pointer;
          text-decoration:none;
          transition:border-color .2s ease, color .2s ease;
        }
        .adm-btn:hover{
          border-color:rgba(37, 99, 235,0.18);
          color:var(--v-accent);
        }
        .adm-btn svg{width:12px;height:12px;color:var(--v-accent);}
        .adm-btn.adm-btn-primary{
          background:var(--v-accent);
          color:var(--v-bg-base);
          border-color:var(--v-accent);
        }
        .adm-btn.adm-btn-primary svg{color:var(--v-bg-base);}
        .adm-btn.adm-btn-primary:hover{
          color:var(--v-bg-base);
          border-color:var(--v-accent);
        }

        .adm-kpis{
          display:grid;
          grid-template-columns:repeat(5, minmax(0, 1fr));
          gap:12px;
          margin-bottom:28px;
        }
        .adm-kpi{
          background:var(--v-bg-card);
          border:1px solid rgba(37, 99, 235,0.08);
          border-radius:10px;
          padding:16px 18px 14px;
        }
        .adm-kpi-lbl{
          font-family:'Montserrat',sans-serif;
          font-size:9.5px;color:#b8b2a8;
          letter-spacing:0.16em;text-transform:uppercase;
          font-weight:500;
          display:flex;justify-content:space-between;align-items:center;
        }
        .adm-kpi-lbl .adm-kpi-ic{color:var(--v-accent);}
        .adm-kpi-lbl .adm-kpi-ic svg{width:13px;height:13px;}
        .adm-kpi-v{
          font-family:'Cormorant Garamond',serif;
          font-weight:500;
          font-size:30px;color:var(--v-text-primary);
          margin-top:10px;line-height:1;
        }
        .adm-kpi-delta{
          margin-top:6px;
          font-family:'Montserrat',sans-serif;
          font-size:10.5px;color:#6ab06a;
          font-weight:500;letter-spacing:0.04em;
        }
        .adm-kpi-delta.neg{color:#c75a5a;}
        .adm-kpi-delta.mute{color:#b8b2a8;}
        .adm-kpi.alert{
          border-color:rgba(212,149,76,0.32);
          background:rgba(212,149,76,0.04);
        }
        .adm-kpi.alert .adm-kpi-v{color:#d4954c;}

        /* === Admin card base =============================================
           Card with header + body, used by the queue and activity. The queue
           adds .adm-queue-* and activity adds .adm-activity-*. */
        .adm-card{
          background:var(--v-bg-card);
          border:1px solid rgba(37, 99, 235,0.08);
          border-radius:10px;
          /* No overflow:hidden — the absolute-positioned ⋯ menus on the last
             AdminPublications row were being clipped by the card. No current
             child relies on the border-radius clip (all have inner padding),
             so dropping it doesn't break visuals. */
        }
        .adm-card-head{
          padding:14px 18px;
          display:flex;justify-content:space-between;align-items:center;
          gap:10px;flex-wrap:wrap;
          border-bottom:1px solid rgba(37, 99, 235,0.08);
        }
        .adm-card-head h3{
          font-family:'Cormorant Garamond',serif;font-weight:500;
          font-size:14px;color:var(--v-accent);
          letter-spacing:0.14em;text-transform:uppercase;
        }
        .adm-card-tabs{display:flex;gap:4px;flex-wrap:wrap;}
        .adm-card-tab{
          padding:5px 11px 4px;
          border-radius:999px;
          color:#b8b2a8;
          background:transparent;
          border:1px solid transparent;
          font-size:11px;font-weight:500;
          letter-spacing:0.04em;
          cursor:pointer;
        }
        .adm-card-tab.adm-card-tab-on{
          background:rgba(37, 99, 235,0.08);
          color:var(--v-accent);
          border-color:rgba(37, 99, 235,0.18);
        }
        .adm-card-ct{
          font-family:'Montserrat',sans-serif;
          font-size:11px;color:#b8b2a8;
          letter-spacing:0.04em;
        }
        /* Listing variants: card-head with search to the right of the title
           + tabs below on their own line. */
        .adm-card-head-stack{flex-direction:column;align-items:stretch;gap:12px;}
        .adm-card-head-row{
          display:flex;align-items:center;justify-content:space-between;
          gap:14px;flex-wrap:wrap;
        }
        .adm-card-head-h3-with-chip{
          font-family:'Cormorant Garamond',serif;font-weight:500;
          font-size:14px;color:var(--v-accent);
          letter-spacing:0.14em;text-transform:uppercase;
          display:inline-flex;align-items:center;gap:8px;
        }
        .adm-card-head-chip{
          background:rgba(37, 99, 235,0.08);
          color:var(--v-accent);
          border:1px solid rgba(37, 99, 235,0.18);
          padding:2px 8px;
          border-radius:999px;
          font-family:'Montserrat',sans-serif;
          font-size:11px;font-weight:500;
          letter-spacing:0;text-transform:none;
        }
        .adm-search-input{
          flex:1;max-width:320px;
          display:flex;align-items:center;gap:9px;
          padding:7px 14px 6px;
          background:rgba(20,17,12,0.6);
          border:1px solid rgba(37, 99, 235,0.08);
          border-radius:999px;
          transition:border-color .2s ease, background .2s ease;
        }
        .adm-search-input:focus-within{
          border-color:rgba(37, 99, 235,0.32);
          background:rgba(20,17,12,0.85);
        }
        .adm-search-input svg{
          width:12px;height:12px;color:var(--v-accent);flex-shrink:0;
        }
        .adm-search-input input{
          flex:1;background:transparent;border:0;outline:0;
          color:#E2E8F0;font-size:12.5px;font-weight:400;
          min-width:0;
        }
        .adm-search-input input::placeholder{color:#7a7060;}
        .adm-search-input button{
          background:transparent;border:0;cursor:pointer;
          color:#7a7060;font-size:12px;padding:0 2px;
          transition:color .2s ease;
        }
        .adm-search-input button:hover{color:var(--v-accent);}

        /* Two-column grid: queue + activity */
        .adm-grid-2{
          display:grid;
          grid-template-columns:1.4fr 1fr;
          gap:18px;
          margin-bottom:28px;
        }

        /* Queue rows */
        .adm-queue-body{display:flex;flex-direction:column;}
        .adm-queue-empty{
          padding:24px 20px;
          font-size:11px;color:#7a7060;
          text-align:center;letter-spacing:0.04em;
        }
        .adm-queue-row{
          padding:13px 18px;
          display:grid;
          grid-template-columns:52px 1fr auto;
          gap:14px;
          align-items:center;
          border-bottom:1px solid rgba(37, 99, 235,0.05);
        }
        .adm-queue-row:last-child{border-bottom:0;}
        .adm-queue-row:hover{background:rgba(37, 99, 235,0.025);}
        .adm-queue-ph{
          position:relative;
          width:52px;height:52px;
          border-radius:50%;
          border:1.5px solid rgba(37, 99, 235,0.4);
          background:var(--v-bg-base);
          overflow:hidden;
          flex-shrink:0;
        }
        .adm-queue-ph-fallback{
          position:absolute;inset:0;
          display:flex;align-items:center;justify-content:center;
          font-family:'Cormorant Garamond',serif;
          font-size:18px;color:var(--v-accent);
        }
        .adm-queue-info{min-width:0;}
        .adm-queue-row1{
          display:flex;align-items:center;gap:8px;flex-wrap:wrap;
          margin-bottom:4px;
        }
        .adm-queue-name{
          font-family:'Cormorant Garamond',serif;font-weight:500;
          font-size:15px;color:var(--v-text-primary);
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          max-width:240px;
        }
        .adm-queue-meta{
          font-size:11px;color:#b8b2a8;
          letter-spacing:0.005em;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        }
        .adm-queue-actions{
          display:flex;gap:6px;
          flex-shrink:0;
        }

        /* Pills (tipo + tier) */
        .adm-pill{
          font-size:9px;padding:3px 7px;
          border-radius:3px;
          letter-spacing:0.14em;text-transform:uppercase;
          font-weight:500;
          border:1px solid transparent;
          white-space:nowrap;
        }
        .adm-pill-report{
          background:rgba(199,90,90,0.10);
          color:#c75a5a;
          border-color:rgba(199,90,90,0.28);
        }
        .adm-pill-story{
          background:rgba(212,149,76,0.10);
          color:#d4954c;
          border-color:rgba(212,149,76,0.28);
        }
        .adm-pill-verif{
          background:rgba(106,176,106,0.10);
          color:#6ab06a;
          border-color:rgba(106,176,106,0.28);
        }
        .adm-pill-review{
          background:rgba(37, 99, 235,0.10);
          color:var(--v-accent);
          border-color:rgba(37, 99, 235,0.28);
        }
        .adm-pill-tier{
          background:var(--v-accent);
          color:var(--v-bg-base);
          border-color:var(--v-accent);
        }

        /* Icon button (circular, used by queue actions) */
        .adm-icon-btn{
          width:30px;height:30px;
          border-radius:50%;
          background:rgba(20,17,12,0.6);
          border:1px solid rgba(37, 99, 235,0.08);
          color:#b8b2a8;
          display:inline-flex;align-items:center;justify-content:center;
          cursor:pointer;
          transition:color .2s ease, border-color .2s ease, background .2s ease;
        }
        .adm-icon-btn:hover{
          color:var(--v-accent);
          border-color:rgba(37, 99, 235,0.32);
        }
        .adm-icon-btn:disabled{opacity:0.4;cursor:not-allowed;}
        .adm-icon-btn-ok:hover{
          color:#6ab06a;
          border-color:rgba(106,176,106,0.4);
          background:rgba(106,176,106,0.05);
        }
        .adm-icon-btn-bad:hover{
          color:#c75a5a;
          border-color:rgba(199,90,90,0.4);
          background:rgba(199,90,90,0.05);
        }
        .adm-icon-btn svg{width:13px;height:13px;}

        /* Activity card */
        .adm-activity-body{padding:14px 18px 18px;}
        .adm-activity-loading,
        .adm-activity-err{
          font-size:11px;color:#7a7060;
          letter-spacing:0.04em;
        }
        .adm-activity-err{color:#c75a5a;}
        .adm-activity-total{
          display:flex;justify-content:space-between;align-items:baseline;
          margin-bottom:10px;gap:8px;flex-wrap:wrap;
        }
        .adm-activity-v{
          font-family:'Cormorant Garamond',serif;font-weight:500;
          font-size:28px;color:var(--v-text-primary);line-height:1;
        }
        .adm-activity-delta{
          font-size:10.5px;color:#6ab06a;font-weight:500;
          letter-spacing:0.04em;
        }
        .adm-activity-delta.neg{color:#c75a5a;}
        .adm-activity-delta.mute{color:#b8b2a8;}
        .adm-activity-spark{
          height:60px;margin-bottom:14px;
          width:100%;display:block;
        }
        .adm-activity-rows{
          display:flex;flex-direction:column;gap:8px;
          padding-top:12px;
          border-top:1px solid rgba(37, 99, 235,0.05);
        }
        .adm-activity-r{
          display:flex;justify-content:space-between;
          font-size:12px;color:var(--v-text-primary);
          font-weight:400;
        }
        .adm-activity-r-l{color:#b8b2a8;}
        .adm-activity-r-v{color:var(--v-accent);font-weight:500;}

        /* Mobile: collapse sidebar, stack KPIs */
        @media(max-width:1023px){
          .adm-grid{grid-template-columns:1fr;}
          .adm-sidebar{display:none;}
          .adm-main{padding:20px 16px 48px;}
          .adm-grid-2{grid-template-columns:1fr;}
        }
        @media(max-width:767px){
          .adm-kpis{grid-template-columns:repeat(2, minmax(0,1fr));}
          .adm-topnav{padding:12px 16px;}
          .adm-user-chip .adm-email{display:none;}
          .adm-page-head h1{font-size:24px;}
          .adm-page-head h1 em{display:block;margin-left:0;margin-top:6px;font-size:0.55em;}
          .adm-queue-row{
            grid-template-columns:44px 1fr;
            grid-template-areas:'ph info' 'ph actions';
            gap:8px;
            padding:11px 14px;
          }
          .adm-queue-ph{width:44px;height:44px;grid-area:ph;align-self:start;}
          .adm-queue-info{grid-area:info;}
          .adm-queue-actions{grid-area:actions;justify-content:flex-end;}
          .adm-queue-name{max-width:160px;font-size:14px;}
          .adm-queue-meta{white-space:normal;}
        }
        @media(max-width:479px){
          .adm-kpis{grid-template-columns:1fr;}
        }

        .v-post-row{
          background:rgba(255,255,255,0.03);padding:20px 24px;border-radius:2px;
          border:1px solid rgba(255,255,255,0.07);
          display:flex;flex-wrap:wrap;align-items:center;
          justify-content:space-between;gap:20px;
          transition:border-color .3s ease,background .3s ease,opacity .3s ease;
        }
        .v-post-row:hover{background:rgba(255,255,255,0.06);}
        .v-post-row.actionable{
          border-color:rgba(37, 99, 235,0.2);
        }
        .v-post-row.inactive{opacity:1}
        .v-post-row.v-post-hidden{border-left:2px solid rgba(37, 99, 235,0.4)}

        /* === Admin card v2 ===========================================
           Redesigned moderation-panel card: info top-row inline (name +
           price + status_dot + tier), tags middle, dates bottom, actions on
           the RIGHT (not below). Replaces .v-post-row for cards in
           AdminPublications.tsx; .v-post-row stays intact for back-compat. */
        .v-admin-card{
          background:rgba(255,255,255,0.03);
          padding:18px 22px;
          border-radius:6px;
          border:1px solid rgba(255,255,255,0.07);
          transition:border-color .3s ease, background .3s ease, opacity .3s ease;
        }
        .v-admin-card:hover{background:rgba(255,255,255,0.05);}
        .v-admin-card.v-post-hidden{opacity:0.65;}
        .v-admin-card-body{
          display:flex;align-items:flex-start;gap:20px;
        }
        .v-admin-card-thumb{
          position:relative;
          width:110px;height:110px;
          flex-shrink:0;
          border:1px solid rgba(255,255,255,0.05);
          border-radius:6px;
          background:var(--v-bg-base);
          overflow:hidden;
        }
        .v-admin-card-info{
          flex:1;min-width:0;
          display:flex;flex-direction:column;gap:8px;
        }
        .v-admin-card-toprow{
          display:flex;align-items:center;gap:14px;flex-wrap:wrap;
        }
        .v-admin-card-name{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:22px;font-weight:400;
          color:var(--v-text-primary);
          letter-spacing:-0.01em;line-height:1.1;
          margin:0;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          max-width:100%;
        }
        .v-admin-card-price{
          font-size:18px;font-weight:400;color:var(--v-accent);
          flex-shrink:0;
        }
        .v-admin-card-actions{
          display:flex;align-items:center;gap:6px;flex-wrap:wrap;
          flex-shrink:0;
          align-self:flex-start;
        }
        .v-admin-card-iddoc-row{
          margin-top:14px;padding-top:14px;
          border-top:1px solid rgba(37, 99, 235,0.15);
          display:flex;align-items:center;gap:8px;flex-wrap:wrap;
        }
        @media(max-width:767px){
          .v-admin-card{padding:14px 14px;}
          .v-admin-card-body{flex-direction:column;gap:14px;}
          .v-admin-card-thumb{width:100%;height:180px;}
          .v-admin-card-actions{width:100%;justify-content:flex-start;}
          .v-admin-card-actions > *{flex:1;min-width:0;}
        }

        .v-admin-btn{
          font-family:'Montserrat',sans-serif;font-size:7px;font-weight:400;
          letter-spacing:.2em;text-transform:uppercase;
          padding:0 16px;height:32px;border-radius:2px;border:1px solid;
          cursor:pointer;
          /* No background declaration here.
             The previous revision set background-color:transparent on
             this class, but the rule lives in a plain stylesheet block
             (non-layered CSS) while Tailwind utilities live in
             @layer utilities — non-layered wins the cascade, so every
             active variant carrying bg-[var(--v-accent)] rendered transparent.
             Tailwind's preflight already sets button background-color
             to transparent in @layer base, which is the outlined
             default we want; utility classes override it naturally.
             NOTE: do NOT write the literal HTML tag for stylesheet blocks
             inside this comment — the CSS parser escapes the leading
             "s" character on the client which trips React #418 hydration
             mismatch. Reword to avoid that token. */
          transition:color .4s ease,border-color .4s ease,background-color .4s ease;
          display:inline-flex;align-items:center;justify-content:center;
          white-space:nowrap;
        }

        /* === Admin button v2 ========================================
           Modernized variant of .v-admin-btn used by the listing cards in
           AdminPublications: title in natural case (no forced uppercase),
           larger font so the SVG icon + label read well side by side, more
           padding. The legacy .v-admin-btn stays intact for the other admin
           sections (Reviews/Reports/Geo/etc.) not yet migrated to the
           icon pattern. */
        .v-admin-btn-v2{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size:11.5px;font-weight:400;letter-spacing:.02em;
          padding:0 14px;height:34px;border-radius:6px;border:1px solid;
          cursor:pointer;
          transition:color .25s ease,border-color .25s ease,background-color .25s ease;
          display:inline-flex;align-items:center;justify-content:center;
          gap:7px;white-space:nowrap;
        }
        .v-admin-btn-v2 svg{flex-shrink:0;width:13px;height:13px;}
        .v-admin-btn-v2.primary{
          text-transform:uppercase;letter-spacing:.1em;font-weight:500;font-size:11px;
        }
        @media(max-width:639px){
          .v-post-row{flex-direction:column!important;gap:12px!important}
          .v-post-info-row{flex-direction:column!important;gap:12px!important;align-items:flex-start!important}
          .v-post-info-row h3{font-size:22px!important;white-space:normal!important}
          .v-post-info-row span{font-size:13px!important}
          .v-action-btns-outer{flex-wrap:wrap!important;width:100%!important;gap:6px!important}
          .v-action-btns-inner{flex-wrap:wrap!important;width:100%!important}
          .v-admin-btn{flex:1!important;min-width:80px!important;text-align:center!important;padding:10px 12px!important;font-size:9px!important;height:40px!important}
          .v-admin-btn-v2{font-size:11px!important;padding:0 12px!important;height:38px!important;}
          .v-chat-wrapper{flex-direction:column!important;height:auto!important;max-height:80vh!important}
          .v-chat-sidebar{width:100%!important;max-height:200px!important;border-right:none!important;border-bottom:1px solid rgba(255,255,255,0.06)!important;overflow-y:auto!important}
        }

        /* Visibility matrix — mobile-only card layout; desktop uses the
           semantic <table> below it (swapped via media query). */
        .adm-matrix-table { display: block; }
        .adm-matrix-cards { display: none; }
        @media(max-width:767px){
          .adm-matrix-table { display: none !important; }
          .adm-matrix-cards { display: flex !important; flex-direction: column; gap: 12px; }
        }
      `}</style>

      <div className="adm-shell">

        {notification && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-6 pointer-events-none">
            <div
              className={`px-8 py-3.5 rounded-[2px] text-[9px] font-normal tracking-[.2em] uppercase shadow-[0_8px_32px_rgba(0,0,0,0.45)] ${
                notification.type === 'error'
                  ? 'border border-[rgba(224,85,85,0.25)] bg-[rgba(40,12,12,0.95)] text-[var(--v-error)]'
                  : 'border border-[rgba(37,99,235,0.25)] bg-[rgba(20,16,8,0.95)] text-[var(--v-accent)]'
              }`}
              style={MONO}
            >
              {notification.text}
            </div>
          </div>
        )}

        <nav className="adm-topnav">
          <div className="adm-topnav-left">
            <Link href="/" className="adm-brand-link" aria-label="Marketplace — inicio">
              <MarketplaceWordmark size={22} />
            </Link>
            <span className="adm-country-chip" aria-hidden="true">{COUNTRY_LABEL}</span>
          </div>
          <div className="adm-topnav-right">
            <ThemeModeSwitch size="sm" />
            <span className="adm-admin-chip" title="Panel de moderación">
              <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z"/></svg>
              Admin
            </span>
            <span className="adm-user-chip">
              <span className="adm-avatar">{(adminEmail?.[0] || 'A').toUpperCase()}</span>
              <span className="adm-email">{adminEmail || 'admin'}</span>
            </span>
          </div>
        </nav>

        <div className="adm-grid">

          <aside className="adm-sidebar">
            <div className="adm-group">
              <div className="adm-group-title">General</div>
              <a className="adm-item adm-item-on" href="#resumen">
                <span className="adm-item-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
                  Resumen
                </span>
              </a>
            </div>

            <div className="adm-group">
              <div className="adm-group-title">Moderación</div>
              <a className="adm-item" href="#verificaciones">
                <span className="adm-item-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z"/><path d="m9 12 2 2 4-4" strokeLinecap="round"/></svg>
                  Verificaciones
                </span>
                {pendingVerifications.length > 0 && (
                  <span className="adm-badge adm-badge-warn">{pendingVerifications.length}</span>
                )}
              </a>
              <a className="adm-item" href="#historias">
                <span className="adm-item-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" strokeDasharray="3 2.5"/><circle cx="12" cy="12" r="4.5"/></svg>
                  Historias
                </span>
                {pendingStories.length > 0 && (
                  <span className="adm-badge">{pendingStories.length}</span>
                )}
              </a>
              <a className="adm-item" href="#reportes">
                <span className="adm-item-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 22V3M4 13l5-3 5 3 6-3v9l-6 3-5-3-5 3"/></svg>
                  Reportes
                </span>
                {pendingReports.length > 0 && (
                  <span className="adm-badge adm-badge-danger">{pendingReports.length}</span>
                )}
              </a>
              <a className="adm-item" href="#resenas">
                <span className="adm-item-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  Reseñas
                </span>
                {pendingReviews.length > 0 && (
                  <span className="adm-badge">{pendingReviews.length}</span>
                )}
              </a>
            </div>

            <div className="adm-group">
              <div className="adm-group-title">Contenido</div>
              <a className="adm-item" href="#publicaciones">
                <span className="adm-item-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/></svg>
                  Publicaciones
                </span>
                {posts.length > 0 && (
                  <span className="adm-badge">{posts.length}</span>
                )}
              </a>
              <a className="adm-item" href="#categorias">
                <span className="adm-item-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l4-4 8 8 5-5"/><path d="M14 5h6v6"/></svg>
                  Categorías
                </span>
              </a>
              <a className="adm-item" href="#geografia">
                <span className="adm-item-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  Geografía
                </span>
              </a>
              <a className="adm-item" href="#tiers">
                <span className="adm-item-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 17 L5 8 L9 13 L12 4 L15 13 L19 8 L21 17 Z M3 19 H21 V21 H3 Z"/></svg>
                  Tiers
                </span>
              </a>
            </div>

            <div className="adm-group">
              <div className="adm-group-title">Sistema</div>
              <Link className="adm-item" href="/admin/audit-log">
                <span className="adm-item-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                  Audit log
                </span>
              </Link>
              <Link className="adm-item" href="/admin/patterns">
                <span className="adm-item-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M9 9c0-1.5 1.3-2.5 3-2.5s3 1 3 2.5-1.3 2-3 2.5v2M12 17v.01"/></svg>
                  Patrones
                </span>
              </Link>
              <button
                type="button"
                className="adm-item"
                onClick={async () => {
                  const secret = await dlg.prompt('Ingresa el secreto de admin:', {
                    title: 'Descargar backup',
                    placeholder: 'admin secret',
                    confirmLabel: 'Descargar',
                  })
                  if (!secret) return
                  const res = await fetch('/api/admin/backup', { headers: { 'x-admin-secret': secret } })
                  if (!res.ok) { await dlg.alert('Acceso denegado o error.', { title: 'Error' }); return }
                  const blob = await res.blob()
                  const url  = URL.createObjectURL(blob)
                  const a    = document.createElement('a')
                  const date = new Date().toISOString().slice(0, 10)
                  a.href     = url
                  a.download = `marketplace-backup-${date}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                <span className="adm-item-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                  Backup
                </span>
              </button>
            </div>
          </aside>

          <main className="adm-main" id="resumen">

          {/* Fetch error banner. Surfaces one line per failed section so a
              transient Supabase blip (network, RLS drift, schema change)
              stops silently zero-ing out queues without warning. The
              "Reintentar" button re-runs the whole load — the function is
              idempotent (setState overwrites) so a double-fire is fine. */}
          {Object.keys(fetchErrors).length > 0 && (
            <div className="v-fadein mb-6 rounded-[2px] border border-[rgba(224,85,85,0.3)] bg-[rgba(224,85,85,0.05)] p-4">
              <div className="flex justify-between items-start gap-4 mb-2">
                <p className="text-[10px] tracking-[.2em] uppercase text-[var(--v-error)]" style={MONO}>
                  Algunas consultas fallaron al cargar
                </p>
                <button
                  type="button"
                  onClick={() => checkAdminAndFetchData()}
                  className="text-[9px] tracking-[.2em] uppercase text-[var(--v-accent)] border border-[rgba(37,99,235,0.35)] px-3 py-1 rounded-[2px] bg-transparent cursor-pointer hover:bg-[rgba(37,99,235,0.08)]"
                  style={MONO}
                >
                  Reintentar
                </button>
              </div>
              <ul className="text-[11px] text-[#9a8888] leading-relaxed list-disc list-inside space-y-0.5">
                {Object.entries(fetchErrors).map(([key, msg]) => (
                  <li key={key}>{msg}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="adm-page-head">
            <h1>Resumen<em>panel de moderación · {COUNTRY_LABEL}</em></h1>
            <div className="adm-page-actions">
              <Link href="/admin/audit-log" className="adm-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                Audit log
              </Link>
              <button
                type="button"
                className="adm-btn"
                onClick={async () => {
                  const secret = await dlg.prompt('Ingresa el secreto de admin:', {
                    title: 'Descargar backup',
                    placeholder: 'admin secret',
                    confirmLabel: 'Descargar',
                  })
                  if (!secret) return
                  const res = await fetch('/api/admin/backup', { headers: { 'x-admin-secret': secret } })
                  if (!res.ok) { await dlg.alert('Acceso denegado o error.', { title: 'Error' }); return }
                  const blob = await res.blob()
                  const url  = URL.createObjectURL(blob)
                  const a    = document.createElement('a')
                  const date = new Date().toISOString().slice(0, 10)
                  a.href     = url
                  a.download = `marketplace-backup-${date}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                Exportar backup
              </button>
              <Link href="/admin/create" className="adm-btn adm-btn-primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                Nueva publicación
              </Link>
            </div>
          </div>

          {(() => {
            const now = Date.now()
            const week = 7 * 24 * 60 * 60 * 1000
            const day  = 24 * 60 * 60 * 1000
            const isFinite = (s: string | null | undefined) => !!s && !Number.isNaN(new Date(s).getTime())
            const postsRecent = posts.filter(p => isFinite(p.created_at) && now - new Date(p.created_at!).getTime() < week).length
            const verifWaiting = pendingVerifications.filter(v => isFinite(v.created_at) && now - new Date(v.created_at!).getTime() > day).length
            return (
              <div className="adm-kpis">
                <div className="adm-kpi">
                  <div className="adm-kpi-lbl">
                    Inventario
                    <span className="adm-kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/></svg></span>
                  </div>
                  <div className="adm-kpi-v">{posts.length}</div>
                  <div className={`adm-kpi-delta ${postsRecent === 0 ? 'mute' : ''}`}>
                    {postsRecent > 0 ? `↑ ${postsRecent} esta semana` : '— sin altas esta semana'}
                  </div>
                </div>
                <div className={`adm-kpi ${verifWaiting > 0 ? 'alert' : ''}`}>
                  <div className="adm-kpi-lbl">
                    Verif. pendientes
                    <span className="adm-kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z"/></svg></span>
                  </div>
                  <div className="adm-kpi-v">{pendingVerifications.length}</div>
                  <div className={`adm-kpi-delta ${verifWaiting > 0 ? 'neg' : 'mute'}`}>
                    {verifWaiting > 0 ? `${verifWaiting} esperan +24h` : '— al día'}
                  </div>
                </div>
                <div className="adm-kpi">
                  <div className="adm-kpi-lbl">
                    Historias en cola
                    <span className="adm-kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" strokeDasharray="3 2.5"/><circle cx="12" cy="12" r="4.5"/></svg></span>
                  </div>
                  <div className="adm-kpi-v">{pendingStories.length}</div>
                  <div className="adm-kpi-delta mute">— Pendientes de revisión</div>
                </div>
                <div className="adm-kpi">
                  <div className="adm-kpi-lbl">
                    Reportes abiertos
                    <span className="adm-kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 22V3M4 13l5-3 5 3 6-3v9l-6 3-5-3-5 3"/></svg></span>
                  </div>
                  <div className="adm-kpi-v">{pendingReports.length}</div>
                  <div className="adm-kpi-delta mute">— sin resolver</div>
                </div>
                <div className="adm-kpi">
                  <div className="adm-kpi-lbl">
                    Reseñas pendientes
                    <span className="adm-kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
                  </div>
                  <div className="adm-kpi-v">{pendingReviews.length}</div>
                  <div className="adm-kpi-delta mute">— esperando aprobación</div>
                </div>
              </div>
            )
          })()}

          <div id="cola" className="adm-grid-2">
            <AdminQueue
              reports={pendingReports}
              stories={pendingStories}
              // FEATURE_KYC off → no verifications surfaced in the unified queue.
              verifications={KYC_ON ? pendingVerifications : []}
              reviews={pendingReviews}
              onRemoveReport={id => setPendingReports(prev => prev.filter(r => r.id !== id))}
              onRemoveStory={id => setPendingStories(prev => prev.filter(s => s.id !== id))}
              onRemoveReview={id => setPendingReviews(prev => prev.filter(r => r.id !== id))}
              onRefetchVerifications={fetchVerifications}
              notify={showNotification}
              adminId={currentAdminId}
            />
            <AdminActivity />
          </div>

          <section id="categorias" className="adm-card mb-7">
            <div className="adm-card-head">
              <h3>Categorías por país</h3>
              <button
                type="button"
                onClick={() => setShowCatModal(true)}
                className="adm-btn"
                style={{ padding: '6px 13px 5px', fontSize: 11 }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
                Categoría
              </button>
            </div>
            <div className="p-5 overflow-x-auto max-w-full" style={{ WebkitOverflowScrolling: 'touch' }}>
              <div className="adm-matrix-cards">
                {dynamicCategories.map(cat => (
                  <div
                    key={`c-${cat.slug}`}
                    className="bg-[var(--v-bg-elevated)] border border-white/5 rounded-[2px] p-3.5"
                  >
                    <button
                      onClick={() => toggleCategoryRow(cat.id, cat.slug, cat.active)}
                      className="flex items-center gap-2.5 border-b border-white/5 pb-2.5 mb-2.5 bg-transparent border-0 w-full justify-start text-left p-0 pb-2.5 cursor-pointer"
                      style={{ fontFamily: 'inherit' }}
                    >
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${cat.active ? 'bg-[var(--v-success)]' : 'bg-[#555]'}`}
                      />
                      <span
                        className={`text-[12px] font-medium tracking-[.08em] flex-1 ${cat.active ? 'text-[var(--v-text-primary)]' : 'text-[#555]'}`}
                        style={MONO}
                      >
                        {cat.name}
                      </span>
                      <span
                        onClick={e => { e.stopPropagation(); deleteCategory(cat.id, cat.slug) }}
                        className="text-[rgba(224,85,85,0.5)] text-[12px] px-2 py-1 cursor-pointer"
                        title="Eliminar categoría"
                      >✕</span>
                    </button>
                    {cities.map(city => {
                      const vis = getCityCategoryVisible(city.slug, cat.slug)
                      const enabled = cat.active && city.active
                      const showOn = enabled && vis
                      return (
                        <div
                          key={`cc-${cat.slug}-${city.slug}`}
                          className="flex items-center justify-between py-2 border-t border-white/[0.03] first:border-t-0"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${city.active ? 'bg-[var(--v-success)]' : 'bg-[#555]'}`} />
                            <span
                              className={`text-[11px] font-normal tracking-[.06em] ${city.active ? 'text-[var(--v-accent)]' : 'text-[#555]'}`}
                              style={MONO}
                            >
                              {city.name}
                            </span>
                          </div>
                          <button
                            onClick={() => enabled && toggleCityCategory(city.slug, cat.slug, !vis)}
                            disabled={!enabled}
                            className={`relative w-[38px] h-5 rounded-[10px] p-0 box-border transition-colors ${
                              showOn
                                ? 'bg-[rgba(80,160,80,0.2)] border border-[rgba(80,160,80,0.5)]'
                                : 'bg-white/5 border border-white/10'
                            } ${enabled ? 'cursor-pointer opacity-100' : 'cursor-not-allowed opacity-30'}`}
                          >
                            <div
                              className={`absolute top-px w-4 h-4 rounded-full transition-[left] ${showOn ? 'bg-[var(--v-success)]' : 'bg-[#555]'}`}
                              style={{ left: showOn ? '19px' : '1px' }}
                            />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ))}

              </div>

              <table className="adm-matrix-table border-collapse w-full min-w-[500px]">
                <thead>
                  <tr>
                    <th
                      className="px-3 py-2.5 text-left text-[8px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] border-b border-white/5"
                      style={MONO}
                    >
                      Categoría ↓ / País →
                    </th>
                    {cities.map(c => (
                      <th
                        key={c.slug}
                        className="px-3 py-2.5 text-center border-b border-white/5"
                      >
                        <button
                          onClick={() => toggleCountryColumn(c.id, c.slug, c.active)}
                          className="bg-transparent border-0 cursor-pointer flex flex-col items-center gap-1 mx-auto p-0"
                          style={{ fontFamily: 'inherit' }}
                          title="Click para activar/desactivar país y todas sus categorías"
                        >
                          <span
                            className={`text-[9px] font-normal tracking-[.22em] uppercase ${c.active ? 'text-[var(--v-accent)]' : 'text-[#555]'}`}
                            style={MONO}
                          >
                            {c.name}
                          </span>
                          <span className={`w-2 h-2 rounded-full ${c.active ? 'bg-[var(--v-success)]' : 'bg-[#555]'}`} />
                        </button>
                      </th>
                    ))}
                    <th className="py-2.5 w-7" />
                  </tr>
                </thead>
                <tbody>
                  {dynamicCategories.map(cat => (
                    <tr key={cat.slug}>
                      <td className="px-3 py-2.5 border-b border-white/5">
                        <button
                          onClick={() => toggleCategoryRow(cat.id, cat.slug, cat.active)}
                          className="flex items-center gap-2 bg-transparent border-0 cursor-pointer p-0"
                          style={{ fontFamily: 'inherit' }}
                          title="Click para activar/desactivar categoría en todos los países"
                        >
                          <span className={`w-2 h-2 rounded-full ${cat.active ? 'bg-[var(--v-success)]' : 'bg-[#555]'}`} />
                          <span
                            className={`text-[10px] font-normal tracking-[.1em] ${cat.active ? 'text-[var(--v-text-primary)]' : 'text-[#555]'}`}
                            style={MONO}
                          >
                            {cat.name}
                          </span>
                        </button>
                      </td>
                      {cities.map(city => {
                        const vis = getCityCategoryVisible(city.slug, cat.slug)
                        const enabled = cat.active && city.active
                        const showOn = enabled && vis
                        return (
                          <td
                            key={city.slug}
                            className="px-3 py-2.5 text-center border-b border-white/5"
                          >
                            <button
                              onClick={() => enabled && toggleCityCategory(city.slug, cat.slug, !vis)}
                              disabled={!enabled}
                              className={`relative w-[38px] h-5 rounded-[10px] p-0 box-border transition-colors ${
                                showOn
                                  ? 'bg-[rgba(80,160,80,0.2)] border border-[rgba(80,160,80,0.5)]'
                                  : 'bg-white/5 border border-white/10'
                              } ${enabled ? 'cursor-pointer opacity-100' : 'cursor-not-allowed opacity-30'}`}
                              title={!enabled ? 'Categoría o país inactivo' : (vis ? 'Click para ocultar' : 'Click para mostrar')}
                            >
                              <div
                                className={`absolute top-px w-4 h-4 rounded-full transition-[left] ${showOn ? 'bg-[var(--v-success)]' : 'bg-[#555]'}`}
                                style={{ left: showOn ? '19px' : '1px' }}
                              />
                            </button>
                          </td>
                        )
                      })}
                      <td className="py-2.5 text-center border-b border-white/5">
                        <button
                          onClick={() => deleteCategory(cat.id, cat.slug)}
                          className="bg-transparent border-0 cursor-pointer text-[rgba(224,85,85,0.3)] hover:text-[var(--v-error)] transition-colors text-[12px] p-1"
                          title="Eliminar categoría"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p
                className="text-[8px] font-normal text-[#555] mt-3 leading-relaxed"
                style={MONO}
              >
                · Click en el nombre de la <b>categoría</b> → activa/desactiva en todos los países.<br />
                · Click en el nombre del <b>país</b> → activa/desactiva el país con todas sus categorías.<br />
                · Click en el <b>toggle</b> → mostrar/ocultar esa combinación específica.
              </p>
            </div>
          </section>

          <AdminReports
            reports={pendingReports}
            adminId={currentAdminId}
            onRemoveReport={id => setPendingReports(prev => prev.filter(r => r.id !== id))}
            onRemovePost={id => setPosts(prev => prev.filter(p => p.id !== id))}
            notify={showNotification}
          />

          {STORIES_ON && (
            <AdminStories
              stories={pendingStories}
              onRemove={(id: string) => setPendingStories(prev => prev.filter(s => s.id !== id))}
              notify={showNotification}
            />
          )}

          <AdminPublications
            posts={posts}
            profileMap={profileMap}
            onRefetch={checkAdminAndFetchData}
            notify={showNotification}
          />
          {/* Gated by FEATURE_KYC (kycEnabled): with the flag off the whole
              verification module is hidden — no admin queue, no /dashboard/verify
              entry points, no verified badge. */}
          {KYC_ON && (
            <AdminVerifications
              verifications={pendingVerifications}
              onRefetch={fetchVerifications}
              openDocument={openDocument}
              notify={showNotification}
            />
          )}

          {/* Pilar #0 — 2257 record review + content moderation. Gated by the
              same FEATURE_KYC flag as the verification module: with KYC off the
              whole 18+/2257/content pillar UI is hidden (the DB guards stay on
              regardless). Content moderation (AdminContentQueue) self-fetches. */}
          {KYC_ON && (
            <>
              <AdminPerformers
                performers={pendingPerformers}
                onRefetch={fetchPerformers}
                notify={showNotification}
              />
              <AdminContentQueue notify={showNotification} />
            </>
          )}

          {REVIEWS_ON && (
            <AdminReviews
              reviews={pendingReviews}
              onRemove={(id: string) => setPendingReviews(prev => prev.filter(r => r.id !== id))}
              notify={showNotification}
            />
          )}

          <div className="adm-grid-2">
            <AdminGeo notify={showNotification} />
            <AdminTierSettings notify={showNotification} />
          </div>

          {showCatModal && (
            <div
              className="fixed inset-0 bg-black/90 z-[1000] flex items-center justify-center p-6"
              onClick={() => setShowCatModal(false)}
            >
              <div
                className="bg-[var(--v-bg-card)] border border-[var(--v-accent)]/20 p-8 max-w-[360px] w-full rounded-[2px]"
                onClick={e => e.stopPropagation()}
              >
                <h3 className="text-[22px] font-normal text-[var(--v-accent)] mb-6">Nueva Categoría</h3>
                <div className="flex flex-col gap-4">
                  <input
                    value={newCat.name}
                    onChange={e => { const n = e.target.value; setNewCat({ ...newCat, name: n, slug: n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '') }) }}
                    placeholder="Nombre"
                    className="w-full bg-[var(--v-bg-base)] border border-white/5 px-3.5 py-3 rounded-[2px] outline-none text-[12px] font-normal text-[var(--v-text-primary)] box-border"
                    style={MONO}
                  />
                  <input
                    value={newCat.slug}
                    onChange={e => setNewCat({ ...newCat, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '') })}
                    placeholder="slug"
                    className="w-full bg-[var(--v-bg-base)] border border-white/5 px-3.5 py-3 rounded-[2px] outline-none text-[12px] font-normal text-[var(--v-text-tertiary)] box-border"
                    style={MONO}
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={createCategory}
                      className="flex-1 bg-[var(--v-accent)] text-[var(--v-bg-base)] p-3.5 border-0 rounded-[2px] cursor-pointer text-[9px] font-normal tracking-[.18em] uppercase"
                      style={MONO}
                    >
                      Crear
                    </button>
                    <button
                      onClick={() => setShowCatModal(false)}
                      className="flex-1 bg-transparent text-[var(--v-text-tertiary)] p-3.5 border border-white/5 rounded-[2px] cursor-pointer text-[9px] font-normal tracking-[.18em] uppercase"
                      style={MONO}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Hidden in concierge mode — kept in DOM-as-dead-code via {false &&}
              so the data fetching above (supportThreads, chatMessages, etc.)
              keeps working if we re-enable the section later. */}
          {false && (
          <div className="mt-16 pt-12 border-t border-white/5">
            <h2 className="text-[clamp(20px,3vw,28px)] font-normal text-[var(--v-accent)] mb-6">
              Chat de Soporte
              {supportThreads.reduce((s, t) => s + t.unread, 0) > 0 && (
                <span
                  className="ml-3 text-[12px] text-white bg-[#25D366] px-2.5 py-1 rounded-xl font-medium"
                  style={MONO}
                >
                  {supportThreads.reduce((s, t) => s + t.unread, 0)}
                </span>
              )}
            </h2>

            <div className="v-chat-wrapper flex border border-white/5 rounded-lg overflow-hidden h-[520px] bg-[var(--v-bg-elevated)]">
              <div className="v-chat-sidebar w-[320px] border-r border-white/5 flex flex-col bg-[var(--v-bg-card)] flex-shrink-0">
                <div className="p-4 border-b border-white/5">
                  <div className="flex items-center gap-2 bg-white/5 rounded-[20px] px-3.5 py-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--v-text-tertiary)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <span className="text-[11px] font-normal text-[#555]" style={MONO}>
                      Buscar conversación...
                    </span>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {supportThreads.length === 0 && (
                    <p className="text-[11px] font-normal text-[#555] text-center px-5 py-10" style={MONO}>
                      Sin conversaciones
                    </p>
                  )}
                  {supportThreads.map(t => {
                    const isSelected = selectedChatUser === t.userId
                    const timeStr = t.lastTime ? new Date(t.lastTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : ''
                    return (
                      <button
                        key={t.userId}
                        onClick={() => loadChatMessages(t.userId)}
                        className={`flex items-center gap-3 px-4 py-3.5 w-full border-0 cursor-pointer text-left border-b border-white/[0.03] transition-colors ${
                          isSelected ? 'bg-[var(--v-accent)]/10' : 'bg-transparent hover:bg-white/[0.02]'
                        }`}
                      >
                        <div
                          className="w-10 h-10 rounded-full flex-shrink-0 bg-[linear-gradient(135deg,rgba(37,99,235,0.25),rgba(37,99,235,0.1))] flex items-center justify-center text-[16px] font-semibold text-[var(--v-accent)]"
                        >
                          {(t.name || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center mb-0.5">
                            <span
                              className={`text-[12px] text-[#E0DAD0] overflow-hidden text-ellipsis whitespace-nowrap ${t.unread > 0 ? 'font-medium' : 'font-light'}`}
                              style={MONO}
                            >
                              {t.name}
                            </span>
                            <span
                              className={`text-[9px] font-normal flex-shrink-0 ml-2 ${t.unread > 0 ? 'text-[#25D366]' : 'text-[#555]'}`}
                              style={MONO}
                            >
                              {timeStr}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span
                              className={`text-[11px] overflow-hidden text-ellipsis whitespace-nowrap flex-1 ${
                                t.unread > 0 ? 'font-normal text-[#C8C0B0]' : 'font-extralight text-[#555]'
                              }`}
                              style={MONO}
                            >
                              {t.lastMessage}
                            </span>
                            {t.unread > 0 && (
                              <span
                                className="bg-[#25D366] text-white text-[9px] font-semibold rounded-full w-[18px] h-[18px] flex items-center justify-center flex-shrink-0 ml-2"
                              >
                                {t.unread}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {selectedChatUser ? (
                <div className="flex-1 flex flex-col bg-[var(--v-bg-base)]">
                  <div className="px-5 py-3 border-b border-white/5 flex items-center gap-3 bg-[var(--v-bg-card)]">
                    <div className="w-9 h-9 rounded-full bg-[linear-gradient(135deg,rgba(37,99,235,0.25),rgba(37,99,235,0.1))] flex items-center justify-center text-[15px] font-semibold text-[var(--v-accent)]">
                      {(supportThreads.find(t => t.userId === selectedChatUser)?.name || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-[12px] font-normal text-[#E0DAD0]" style={MONO}>
                        {supportThreads.find(t => t.userId === selectedChatUser)?.name || 'Usuario'}
                      </p>
                      <p className="text-[9px] font-normal text-[var(--v-text-tertiary)] flex items-center gap-1" style={MONO}>
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--v-success)] inline-block" />
                        En línea
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-1 bg-[var(--v-bg-base)]">
                    {chatMessages.map((m, mi) => {
                      const isAdmin = m.sender === 'admin'
                      const prevMsg = chatMessages[mi - 1]
                      const showDate = !prevMsg || new Date(m.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString()
                      const sameSender = prevMsg && prevMsg.sender === m.sender
                      return (
                        <div key={m.id}>
                          {showDate && (
                            <div className="text-center pt-3 pb-2">
                              <span
                                className="text-[9px] font-normal text-white/25 bg-white/5 px-3 py-1 rounded-[10px] tracking-[.05em]"
                                style={MONO}
                              >
                                {new Date(m.created_at).toLocaleDateString('es-CL', { day:'numeric', month:'short', year:'numeric' })}
                              </span>
                            </div>
                          )}
                          <div
                            className={`flex flex-col max-w-[70%] ${isAdmin ? 'self-end items-end' : 'self-start items-start'} ${sameSender ? 'mt-0.5' : 'mt-2'}`}
                          >
                            <div
                              className={`px-3.5 py-2 ${
                                isAdmin
                                  ? 'bg-[linear-gradient(135deg,rgba(37,99,235,0.15),rgba(37,99,235,0.08))] rounded-[12px_12px_4px_12px]'
                                  : 'bg-white/5 rounded-[12px_12px_12px_4px]'
                              }`}
                            >
                              <p className="text-[12px] font-normal text-[#E2E8F0] leading-relaxed" style={MONO}>
                                {m.message}
                              </p>
                            </div>
                            <span className="text-[8px] font-normal text-white/20 mt-[3px] px-1" style={MONO}>
                              {new Date(m.created_at).toLocaleTimeString('es-CL', { hour:'2-digit', minute:'2-digit' })}
                              {isAdmin && m.read && <span className="ml-1 text-[rgba(37,211,102,0.6)]">✓✓</span>}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="px-4 py-3 border-t border-white/5 flex items-end gap-2.5 bg-[var(--v-bg-card)]">
                    <input
                      value={chatReply}
                      onChange={e => setChatReply(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAdminReply() } }}
                      placeholder="Escribe un mensaje..."
                      className="flex-1 bg-white/5 border border-white/5 px-4 py-2.5 rounded-[20px] outline-none text-[12px] font-normal text-[#E2E8F0]"
                      style={MONO}
                    />
                    <button
                      onClick={sendAdminReply}
                      disabled={!chatReply.trim()}
                      className={`w-9 h-9 rounded-full border-0 cursor-pointer text-[var(--v-bg-base)] flex items-center justify-center flex-shrink-0 transition-colors ${
                        chatReply.trim() ? 'bg-[var(--v-accent)]' : 'bg-[var(--v-accent)]/20'
                      }`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-[var(--v-bg-base)]">
                  <div className="w-[72px] h-[72px] rounded-full bg-[var(--v-accent)]/5 border border-[var(--v-accent)]/10 flex items-center justify-center text-[28px]">
                    💬
                  </div>
                  <p className="text-[13px] font-normal text-white/25" style={MONO}>
                    Selecciona una conversación
                  </p>
                  <p className="text-[10px] font-normal text-white/15 max-w-[280px] text-center leading-relaxed" style={MONO}>
                    Haz clic en un chat para ver los mensajes y responder
                  </p>
                </div>
              )}
            </div>
          </div>
          )}

          </main>
        </div>
      </div>
    </>
  )
}
