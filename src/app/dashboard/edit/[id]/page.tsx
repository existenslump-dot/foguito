'use client'
import { getUserId, supabaseFetch } from '@/lib/supabase/direct'
import { supabase } from '@/lib/supabase/client'
import { useState, useEffect, use, useRef, useCallback, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { CATEGORIES, TIERS } from '@/lib/categories'
import { useGeoCascade } from '@/hooks/useGeoCascade'
import { useDropzone } from 'react-dropzone'
import imageCompression from 'browser-image-compression'
import {
  validateImageFile,
  validateVideoFile,
  validateAudioFile,
  dropzoneImageAccept,
  dropzoneVideoAccept,
  dropzoneAudioAccept,
} from '@/lib/upload-validation'
import { slugifyTitle } from '@/lib/post-url'
import { COUNTRY_SLUG, MARKET_CURRENCY, COUNTRY_LABEL } from '@/config/marketplace.config'
import dynamic from 'next/dynamic'
import PhotoEditorModal from '@/components/PhotoEditorModal'
import MarketplaceLoader from '@/components/MarketplaceLoader'
import ListingAttributeFields, { type AttributeMap, type AttributeValue } from '@/components/dashboard/ListingAttributeFields'
import GeoCascadePicker from '@/components/dashboard/GeoCascadePicker'
import MediaUploader, { type EditorTarget } from '@/components/dashboard/MediaUploader'
import AdminVerifyForUser from '@/components/admin/AdminVerifyForUser'
import { CLOUDINARY_UPLOAD_PRESET, cloudinaryUploadUrl } from '@/lib/cloudinary.client'

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false })

const TIER_LIMITS: Record<string, { photos: number; videos: number; audios: number }> = {
  elite:    { photos: 18, videos: 3, audios: 1 },
  gold:   { photos: 15, videos: 2, audios: 1 },
  silver:   { photos: 12, videos: 1, audios: 0 },
  bronze:   { photos: 9,  videos: 0, audios: 0 },
  basic: { photos: 6,  videos: 0, audios: 0 },
}

/**
 * Local-draft safety net — dumps the form's text/toggle/chip state to
 * localStorage every 5 s so a hung save, a killed tab, or an overnight
 * refresh doesn't erase the user's edits. File uploads and blob:
 * previews are intentionally excluded (aren't serializable across page
 * loads anyway). Key is namespaced per post id so concurrent edits on
 * different posts don't overwrite each other.
 */
const DRAFT_KEY_PREFIX = 'marketplace:edit-draft:'
const DRAFT_TTL_MS     = 24 * 60 * 60 * 1000 // 24 h

type LocalDraftSnapshot = {
  title: string; description: string; price: string; priceUsd: string; priceEur: string
  currency: string; whatsapp: string; telegram: string; category: string; tier: string
  localidad: string
  attributes: AttributeMap
}

export default function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router   = useRouter()
  const pathname = usePathname()
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [statusMsg, setStatusMsg] = useState<{text: string, type: 'success' | 'error'} | null>(null)

  // Draft pending restore — populated on mount if localStorage has a
  // snapshot for this post newer than its server updated_at. User opts
  // in via the banner so we never silently overwrite server state.
  const [pendingDraft, setPendingDraft] = useState<{ savedAt: number; state: LocalDraftSnapshot } | null>(null)
  // Captured at banner-surface time (not on every render) so the
  // "hace X min" label is a pure read in render and the React Compiler
  // purity rule stops complaining about inlining Date.now().
  const [draftBannerAgeMin, setDraftBannerAgeMin] = useState<number | null>(null)

  const [isAdmin, setIsAdmin]               = useState(false)
  const [originalStatus, setOriginalStatus] = useState<string>('')
  // Loaded for the admin Verificación section — null when the user is
  // editing their own post (the section isn't rendered in that case,
  // so the empty string default never reaches the API).
  const [postUserId, setPostUserId]         = useState<string | null>(null)
  const [adminUserId, setAdminUserId]       = useState<string | null>(null)
  const [postVerificationStatus, setPostVerificationStatus] = useState<string | null>(null)

  const [category, setCategory] = useState('')
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set(['mujer','perfil','hombre','profesional']))
  const [tier, setTier]         = useState('')
  const [title, setTitle]           = useState('')
  const [price, setPrice]           = useState('')
  const [currency, setCurrency]     = useState(MARKET_CURRENCY)
  const [priceUsd, setPriceUsd]     = useState('')
  const [priceEur, setPriceEur]     = useState('')
  const [description, setDescription] = useState('')
  const [city, setCity]             = useState('buenosaires')
  const [whatsapp, setWhatsapp]     = useState('')
  const [telegram, setTelegram]     = useState('')

  // Config-driven listing attributes (src/config/attributes.config.ts),
  // persisted to the `attributes` JSONB column.
  const [attributes, setAttributes]     = useState<AttributeMap>({})
  const setAttribute = (key: string, val: AttributeValue) =>
    setAttributes(prev => ({ ...prev, [key]: val }))
  const geo = useGeoCascade({ countrySlug: COUNTRY_SLUG })
  const [localidad, setLocalidad]       = useState('')

  const [coverVideo, setCoverVideo]                     = useState<File | null>(null)
  const [coverVideoPreview, setCoverVideoPreview]       = useState<string | null>(null)
  const coverVideoRef = useRef<HTMLInputElement>(null)

  const [existingImageUrls, setExistingImageUrls]     = useState<string[]>([])
  const [existingVideoUrls, setExistingVideoUrls]     = useState<string[]>([])
  const [existingAudioUrl, setExistingAudioUrl]       = useState<string | null>(null)
  const [existingAudioFilename, setExistingAudioFilename] = useState('')

  const [newImageFiles, setNewImageFiles]       = useState<File[]>([])
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([])
  const [editedNewImages, setEditedNewImages]   = useState<Record<number, string>>({})
  const [newVideoFiles, setNewVideoFiles]       = useState<File[]>([])
  const [newAudioFile, setNewAudioFile]         = useState<File | null>(null)
  const [coverUrl, setCoverUrl]                 = useState<string | null>(null)
  const [profilePhotoUrl, setProfilePhotoUrl]   = useState<string | null>(null)
  // Identity verification removed — now handled via /dashboard/verify
  const [uploadProgress, setUploadProgress]     = useState<Record<number, number>>({})
  const [editorSrc, setEditorSrc]               = useState<string | null>(null)
  const [editorTarget, setEditorTarget]         = useState<EditorTarget | null>(null)
  const [showEmojiPicker, setShowEmojiPicker]   = useState(false)
  const descRef        = useRef<HTMLTextAreaElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)

  const VE_STEPS = [
    { id: 'basico',      label: 'Perfil' },
    { id: 'contacto',    label: 'Contacto' },
    { id: 'fotos',       label: 'Fotos' },
    { id: 'descripcion', label: 'Descripción' },
    { id: 'atributos',   label: 'Detalles' },
    { id: 'ubicacion',   label: 'Ubicación' },
  ]
  const [activeSection,  setActiveSection]  = useState('basico')
  const scrollToSection = (sid: string) => {
    setActiveSection(sid)
    document.getElementById(`ve-sec-${sid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    fetchPostAndUser()
    // Revoke every blob URL we created in this page so we don't leak
    // memory when the user navigates away with unsaved uploads. Covers
    // image previews (array) plus the single cover-video preview, both of
    // which start life as URL.createObjectURL() outputs.
    return () => {
      newImagePreviews.forEach(url => URL.revokeObjectURL(url))
      if (coverVideoPreview?.startsWith('blob:')) URL.revokeObjectURL(coverVideoPreview)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Runs once per post id on mount: if a recent draft exists, surface
  // the restore banner. We don't auto-apply because the server state
  // might be newer (same user edited from another device, admin
  // approved a revision, etc.) — explicit opt-in keeps the flow safe.
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(DRAFT_KEY_PREFIX + id) : null
      if (!raw) return
      const parsed = JSON.parse(raw) as { savedAt: number; state: LocalDraftSnapshot }
      if (!parsed?.savedAt || !parsed?.state) return
      const ageMs = Date.now() - parsed.savedAt
      if (ageMs > DRAFT_TTL_MS) {
        localStorage.removeItem(DRAFT_KEY_PREFIX + id)
        return
      }
      setPendingDraft(parsed)
      setDraftBannerAgeMin(Math.max(1, Math.round(ageMs / 60_000)))
    } catch { /* quota / malformed JSON — ignore */ }
  }, [id])

  // setInterval-based because listing every form field in the deps array
  // (40+ useStates) is fragile and noisy. A ref captures the latest
  // snapshot function on each render, and the interval invokes it every
  // 5 s while the form is alive. Writes fail silently when the user is
  // in privacy mode or over quota — autosave is a safety net, not a
  // blocking flow, so a missed tick is fine.
  const snapshotFnRef = useRef<() => LocalDraftSnapshot>(() => ({} as LocalDraftSnapshot))
  // Keep snapshotFnRef.current pointed at a closure that captures the
  // latest field values — updating it *inside* a dep-less effect keeps
  // the React-Compiler lint rule happy (mutating a ref during render is
  // flagged). Runs after every render, which is what we want.
  useEffect(() => {
    snapshotFnRef.current = () => ({
      title, description, price, priceUsd, priceEur, currency, whatsapp, telegram,
      category, tier, localidad, attributes,
    })
  })
  useEffect(() => {
    if (loading) return
    const tick = () => {
      try {
        localStorage.setItem(DRAFT_KEY_PREFIX + id, JSON.stringify({
          savedAt: Date.now(),
          state: snapshotFnRef.current(),
        }))
      } catch { /* ignore quota / disabled storage */ }
    }
    tick()
    const iv = setInterval(tick, 5000)
    return () => clearInterval(iv)
  }, [id, loading])

  // Apply a restored draft into the individual state setters. Deliberately
  // granular rather than bulk-replacing the whole form — keeps each setter
  // responsible for its own validation / side effects (e.g. the price
  // formatter still runs if the user edits after restore).
  const restoreDraft = () => {
    if (!pendingDraft) return
    const s = pendingDraft.state
    setTitle(s.title); setDescription(s.description)
    setPrice(s.price); setPriceUsd(s.priceUsd); setPriceEur(s.priceEur)
    setCurrency(s.currency); setWhatsapp(s.whatsapp); setTelegram(s.telegram ?? '')
    setCategory(s.category); setTier(s.tier)
    setLocalidad(s.localidad)
    setAttributes(s.attributes || {})
    setPendingDraft(null)
    setStatusMsg({ text: 'Borrador restaurado.', type: 'success' })
    setTimeout(() => setStatusMsg(null), 2500)
  }

  const discardDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY_PREFIX + id) } catch {}
    setPendingDraft(null)
  }

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Route hygiene: admins on the legacy /dashboard/edit URL get silently
  // upgraded to the /admin/edit equivalent. Keeps the URL honest — admin
  // flows shouldn't live under /dashboard (which is user-scoped), and if
  // the page errors mid-load the user's browser "back" lands them on
  // /admin instead of /dashboard.
  useEffect(() => {
    if (isAdmin && pathname?.startsWith('/dashboard/edit/')) {
      router.replace(pathname.replace('/dashboard/edit/', '/admin/edit/'))
    }
  }, [isAdmin, pathname, router])

  async function fetchPostAndUser() {
    // Wrap the whole fetch in try/finally so the page never stays stuck on
    // the loading spinner — previously, if any of the supabase calls threw
    // (RLS error, network blip, malformed UUID in the URL) the unhandled
    // rejection bypassed setLoading(false) and the user saw the accent line
    // forever. Errors are surfaced via the existing statusMsg toast.
    //
    // Direct PostgREST (not the SDK) to skip the navigator.locks auth-token
    // mutex. A stuck lock — from a parallel session refresh, an admin
    // background fetch, or a lingering /admin tab — was leaving this page
    // frozen on "CARGANDO PUBLICACIÓN" forever because every `await
    // supabase.*` queued behind the held lock and none of the network
    // requests ever fired. See src/lib/supabase/direct.ts for the why.
    try {
      const userId = getUserId()

      // Three independent reads parallelized (vs a sequential chain) to cut
      // load latency.
      const [profileRes, catsRes, postRes] = await Promise.all([
        userId
          ? supabaseFetch<Array<{ is_admin: boolean }>>(`profiles?select=is_admin&id=eq.${encodeURIComponent(userId)}`)
          : Promise.resolve({ data: null, error: null }),
        supabaseFetch<Array<{ id: string; active: boolean }>>(`categories?select=id,active`),
        supabaseFetch<Record<string, unknown>>(`posts?select=*&id=eq.${encodeURIComponent(id)}`, { single: true }),
      ])

      if (profileRes.data && profileRes.data[0]) {
        setIsAdmin(!!profileRes.data[0].is_admin)
      }
      // Stash the admin's own UUID so the embedded Verificación section
      // can guard against the admin "verifying themselves" — only enable
      // it when post.user_id differs from this.
      if (userId) setAdminUserId(userId)

      if (catsRes.data) {
        const activeIds = new Set(catsRes.data.filter(c => c.active).map(c => c.id))
        if (activeIds.size > 0) setActiveCategories(activeIds)
      }

      if (postRes.error) {
        console.error('[edit] post fetch failed:', postRes.error)
        setStatusMsg({ text: 'No se pudo cargar la publicación: ' + postRes.error.message, type: 'error' })
        return
      }
      // `single: true` returns the first row under `data` or null — matches
      // the old `.single()` contract without throwing on not-found.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const post = postRes.data as any
      if (post) {
        setOriginalStatus(post.status)
        setPostUserId(post.user_id ?? null)
        setPostVerificationStatus(post.verification_status ?? null)
        setCategory(post.category || '')
        setTier(post.tier || '')
        setTitle(post.title)
        setCurrency(post.currency || MARKET_CURRENCY)
        setPrice(post.price ? post.price.toLocaleString('es-CL').replace(/,/g, '.') : '')
        setDescription(post.description)
        // Country picker state stays at its default ('buenosaires' = Argentina).
        // Real geo lives in country_id/provincia_id/... below via geo.prefill().
        setWhatsapp(post.whatsapp_number || '')
        setTelegram(post.telegram_number || '')
        setExistingImageUrls(post.image_urls || [])
        setExistingVideoUrls(post.video_urls || [])
        setExistingAudioUrl(post.audio_url)
        setExistingAudioFilename(post.audio_filename || '')
        if (post.image_urls?.length > 0) setCoverUrl(post.image_urls[0])
        setProfilePhotoUrl(post.profile_photo_url || null)
        setAttributes((post.attributes as AttributeMap) || {})
        setLocalidad(post.localidad || '')
        geo.prefill({
          provinciaId: post.provincia_id ?? null,
          comunaId:    post.comuna_id    ?? null,
          barrioId:    post.barrio_id    ?? null,
        })
        setPriceUsd(post.price_usd ? post.price_usd.toString() : '')
        setPriceEur(post.price_eur ? post.price_eur.toString() : '')
        if (post.cover_video_url) setCoverVideoPreview(post.cover_video_url)
      }
    } catch (err) {
      console.error('[edit] fetchPostAndUser unexpected error:', err)
      setStatusMsg({ text: 'Error al cargar: ' + (err instanceof Error ? err.message : String(err)), type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const uploadFile = useCallback(async (file: File, type: 'image' | 'video' | 'auto', idx?: number): Promise<string> => {
    let fileToUpload = file
    if (type === 'image') {
      try {
        fileToUpload = await imageCompression(file, {
          maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true,
          onProgress: idx !== undefined ? (p: number) => setUploadProgress(prev => ({ ...prev, [idx]: p })) : undefined,
        }) as File
      } catch { /* keep original */ }
      // Watermarking is applied at render-time (Cloudinary overlay, see
      // lib/cloudinary.ts) so source files stay clean.
    }
    return new Promise((resolve, reject) => {
      const formData = new FormData()
      formData.append('file', fileToUpload)
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', cloudinaryUploadUrl(type))
      // 3-minute ceiling on any single upload — without it, a dropped TCP
      // connection or a killed Cloudinary response leaves the xhr hanging
      // forever, so the Promise.all in handleUpdate never resolves and the
      // save loader stays stuck.
      xhr.timeout = 180_000
      if (idx !== undefined && type !== 'image') {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(prev => ({ ...prev, [idx]: Math.round((e.loaded / e.total) * 100) }))
        }
      }
      xhr.onload = () => {
        if (xhr.status === 200) resolve(JSON.parse(xhr.responseText).secure_url)
        else reject(new Error(`Upload failed (HTTP ${xhr.status})`))
      }
      xhr.onerror   = () => reject(new Error('Network error'))
      xhr.ontimeout = () => reject(new Error('Upload timeout (>180s)'))
      xhr.send(formData)
    })
  }, [])

  const formatThousands = (val: string) => {
    const digits = val.replace(/\D/g, '')
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  }

  const tierLimits = useMemo(
    () => TIER_LIMITS[tier] ?? { photos: 6, videos: 0, audios: 0 },
    [tier],
  )
  const totalImages = existingImageUrls.length + newImageFiles.length

  const onDrop = useCallback((files: File[]) => {
    // MIME whitelist — `accept: 'image/*'` would happily admit SVG,
    // which carries inline <script> and turns into stored XSS the
    // moment Cloudinary serves it. Re-validate inside onDrop because
    // dropzone `accept` is OS-picker advisory only — drag-and-drop and
    // scripted submissions bypass it.
    const imgs: File[] = []
    const vids: File[] = []
    const auds: File[] = []
    for (const f of files) {
      if (f.type.startsWith('image/')) {
        const r = validateImageFile(f)
        if (!r.ok) { setStatusMsg({ text: r.reason, type: 'error' }); continue }
        imgs.push(f)
      } else if (f.type.startsWith('video/')) {
        const r = validateVideoFile(f)
        if (!r.ok) { setStatusMsg({ text: r.reason, type: 'error' }); continue }
        vids.push(f)
      } else if (f.type.startsWith('audio/')) {
        const r = validateAudioFile(f)
        if (!r.ok) { setStatusMsg({ text: r.reason, type: 'error' }); continue }
        auds.push(f)
      }
    }
    if (imgs.length) {
      const maxPhotos = tierLimits.photos
      if (totalImages + imgs.length > maxPhotos) return
      setNewImageFiles(prev => [...prev, ...imgs])
      setNewImagePreviews(prev => [...prev, ...imgs.map(f => URL.createObjectURL(f))])
    }
    if (vids.length) {
      const maxVideos = tierLimits.videos
      if (existingVideoUrls.length + newVideoFiles.length + vids.length <= maxVideos) {
        setNewVideoFiles(prev => [...prev, ...vids])
      }
    }
    if (auds.length && !newAudioFile && !existingAudioUrl) {
      setNewAudioFile(auds[0])
    }
  }, [tierLimits, totalImages, existingVideoUrls, newVideoFiles, newAudioFile, existingAudioUrl])

  const dropzoneAccept: Record<string, string[]> = dropzoneImageAccept()
  if (tierLimits.videos > 0) Object.assign(dropzoneAccept, dropzoneVideoAccept())
  if (tierLimits.audios > 0) Object.assign(dropzoneAccept, dropzoneAudioAccept())
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: dropzoneAccept,
    onDrop,
  })

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!category) return setStatusMsg({ text: 'Selecciona una categoría', type: 'error' })
    if (!tier)     return setStatusMsg({ text: 'Selecciona un tier', type: 'error' })
    if (!coverUrl) return setStatusMsg({ text: 'Selecciona una portada', type: 'error' })

    await runUpdate()
  }

  const runUpdate = async () => {
    if (!coverUrl) return
    setSaving(true)
    setUploadProgress({})
    // Stuck-save watchdog: the fullscreen "Guardando cambios" loader is
    // dismissed by `finally{ setSaving(false) }`, but that only runs
    // when every `await` resolves. A dropped TCP connection or an idle
    // fetch with no native timeout leaves a promise pending forever and
    // the loader becomes a dead modal the user can't dismiss. This
    // watchdog is the hard ceiling — 90 s is longer than any reasonable
    // single-post save, short enough that a stuck UI clears before the
    // user reaches for Ctrl+R and loses their edits.
    const stuckSaveTimer = setTimeout(() => {
      console.error('[edit post] save watchdog tripped — forcing loader clear after 90s')
      setStatusMsg({ text: 'La sincronización tardó demasiado. Tus cambios quedaron respaldados localmente — recargá la página para restaurarlos y reintentar.', type: 'error' })
      setSaving(false)
    }, 90_000)
    // Every exit path has to clear the fullscreen "Guardando" loader —
    // earlier versions missed some branches and left the UI stuck on a
    // modal the user couldn't dismiss. finally{} is the backstop; the
    // success path still clears early so the toast is visible before the
    // 2.5s redirect fires.
    try {
      // AbortController caps this fetch at 10 s — the route does pure
      // arithmetic on TIER_LIMITS, so anything longer is a cold function or
      // a dropped connection; fail fast rather than stall the save.
      const totalPhotos = existingImageUrls.length + newImageFiles.length
      const totalVideos = existingVideoUrls.length + newVideoFiles.length
      const totalAudios = (existingAudioUrl || newAudioFile) ? 1 : 0
      const valAbort = new AbortController()
      const valTimeout = setTimeout(() => valAbort.abort(), 10_000)
      let valRes: Response
      try {
        valRes = await fetch('/api/posts/validate-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tier,
            photoCount: totalPhotos,
            videoCount: totalVideos,
            audioCount: totalAudios,
          }),
          signal: valAbort.signal,
        })
      } finally {
        clearTimeout(valTimeout)
      }
      if (!valRes.ok) {
        const { error } = await valRes.json()
        setStatusMsg({ text: error || 'Error de validación de medios', type: 'error' })
        return
      }

      const uploadedImgs = await Promise.all(newImageFiles.map(async (f, i) => {
        if (editedNewImages[i]) {
          const res = await fetch(editedNewImages[i])
          const blob = await res.blob()
          const edited = new File([blob], f.name, { type: 'image/jpeg' })
          return uploadFile(edited, 'image', i)
        }
        return uploadFile(f, 'image', i)
      }))

      // Promote any `data:` URL that slipped into existingImageUrls via the
      // PhotoEditorModal "existing" path to a real Cloudinary upload.
      // Without this, the dataURL gets serialized into the image_urls
      // TEXT[] column as a ~200 KB base64 string and never gets the
      // Cloudinary watermark overlay (the URL doesn't match
      // res.cloudinary.com so injectTransform no-ops).
      const promotedExistingImgs = await Promise.all(
        existingImageUrls.map(async (url, i) => {
          if (!url.startsWith('data:')) return url
          const res  = await fetch(url)
          const blob = await res.blob()
          const f    = new File([blob], `edited-existing-${i}.jpg`, { type: 'image/jpeg' })
          return uploadFile(f, 'image')
        }),
      )

      // If the cover was edited (coverUrl is a dataURL), resolve it to the
      // freshly-uploaded Cloudinary URL so finalImgs[0] stays clean. Two paths:
      //   Case 1: cover was an existing image edited inline — dataURL is in
      //           existingImageUrls; map to the promoted Cloudinary URL.
      //   Case 2: cover was a NEW image edited before save — dataURL is in
      //           editedNewImages (keyed by newImageFiles index); map to
      //           uploadedImgs[idx].
      let resolvedCover = coverUrl
      if (coverUrl?.startsWith('data:')) {
        const existingIdx = existingImageUrls.indexOf(coverUrl)
        if (existingIdx !== -1) {
          resolvedCover = promotedExistingImgs[existingIdx]
        } else {
          for (const [k, v] of Object.entries(editedNewImages)) {
            if (v === coverUrl) { resolvedCover = uploadedImgs[parseInt(k)]; break }
          }
        }
      }

      // Build finalImgs: cover first, then the rest, deduped and sliced to
      // the tier photo limit — mirrors the `.slice(0, tierLimits.videos)`
      // contract that video_urls uses.
      const newCoverPreviewIdx = newImagePreviews.indexOf(resolvedCover!)
      const coverFinalUrl = newCoverPreviewIdx !== -1
        ? uploadedImgs[newCoverPreviewIdx]
        : resolvedCover!
      const otherImgs = [...promotedExistingImgs, ...uploadedImgs].filter(u => u !== coverFinalUrl)
      const finalImgs = Array.from(new Set([coverFinalUrl, ...otherImgs]))
        .filter(u => u && !u.startsWith('data:') && !u.startsWith('blob:'))
        .slice(0, tierLimits.photos)

      let finalProfileUrl: string | null = profilePhotoUrl
      if (profilePhotoUrl) {
        if (profilePhotoUrl.startsWith('data:')) {
          const existingIdx = existingImageUrls.indexOf(profilePhotoUrl)
          if (existingIdx !== -1) {
            finalProfileUrl = promotedExistingImgs[existingIdx]
          } else {
            for (const [k, v] of Object.entries(editedNewImages)) {
              if (v === profilePhotoUrl) { finalProfileUrl = uploadedImgs[parseInt(k)]; break }
            }
          }
        } else if (profilePhotoUrl.startsWith('blob:')) {
          const newIdx = newImagePreviews.indexOf(profilePhotoUrl)
          if (newIdx !== -1) finalProfileUrl = uploadedImgs[newIdx]
        }
      }

      const uploadedVids   = await Promise.all(newVideoFiles.map(f => uploadFile(f, 'video')))
      const finalAudio     = newAudioFile ? await uploadFile(newAudioFile, 'auto') : existingAudioUrl
      const finalAudioName = newAudioFile ? newAudioFile.name : existingAudioFilename

      // Direct PostgREST write — same lock-contention rationale as the
      // fetchPostAndUser path above. supabase.auth.getUser() / from().update()
      // queue behind the auth-token mutex and have been observed to hang
      // indefinitely in production when a parallel refresh was in flight.
      const userId = getUserId()

      // Resolve cover_video_url for the PATCH. Three states:
      //   string    → upload (new file) or keep existing Cloudinary URL
      //   null      → user explicitly cleared the video → wipe column
      //   undefined → tier doesn't support cover video → don't touch column
      // The null/undefined distinction matters: collapsing null → undefined
      // would skip the field and leave a cleared video still persisted.
      let coverVideoUrl: string | null | undefined
      if (tier === 'gold' || tier === 'elite') {
        if (coverVideo) {
          coverVideoUrl = await uploadFile(coverVideo, 'video')
        } else {
          coverVideoUrl = coverVideoPreview
        }
      }

      const rawPrice = parseInt(price.replace(/\D/g, '')) || 0
      const postSlug = slugifyTitle(title)
      const commonData = {
        title, description, price: rawPrice, currency,
        whatsapp_number: whatsapp,
        telegram_number: telegram || null,
        post_slug: postSlug,
        image_urls: finalImgs,
        video_urls: [...existingVideoUrls, ...uploadedVids].slice(0, tierLimits.videos),
        audio_url: finalAudio, audio_filename: finalAudioName,
        category, tier,
        attributes,
        ...(priceUsd ? { price_usd: parseInt(priceUsd.replace(/\D/g, '')) } : {}),
        ...(priceEur ? { price_eur: parseInt(priceEur.replace(/\D/g, '')) } : {}),
        localidad: [geo.labels.barrio, geo.labels.comuna, geo.labels.provincia].filter(Boolean).join(', ') || localidad || null,
        ...(geo.provinciaId ? { provincia_id: geo.provinciaId } : { provincia_id: null }),
        ...(geo.comunaId    ? { comuna_id:    geo.comunaId    } : { comuna_id:    null }),
        ...(geo.barrioId    ? { barrio_id:    geo.barrioId    } : { barrio_id:    null }),
        ...(coverVideoUrl !== undefined ? { cover_video_url: coverVideoUrl } : {}),
        profile_photo_url: finalProfileUrl,
      }

      if (isAdmin) {
        const { error } = await supabaseFetch(
          `posts?id=eq.${encodeURIComponent(id)}`,
          { method: 'PATCH', body: { ...commonData, status: 'published', is_approved: true, rejection_reason: null }, noReturn: true },
        )
        if (error) throw new Error(error.message)
        fetch('/api/posts/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId: id, event: 'edit' }),
        }).catch(err => console.error('[edit post] audit call failed (admin path)', err))
        setStatusMsg({ text: 'Cambios aplicados como administrador', type: 'success' })
      } else if (originalStatus === 'rejected') {
        const { error } = await supabaseFetch(
          `posts?id=eq.${encodeURIComponent(id)}`,
          { method: 'PATCH', body: { ...commonData, status: 'pending', is_approved: false, rejection_reason: null }, noReturn: true },
        )
        if (error) throw new Error(error.message)
        fetch('/api/posts/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId: id, event: 'edit' }),
        }).catch(err => console.error('[edit post] audit call failed (rejected resubmit path)', err))
        setStatusMsg({ text: 'Anuncio corregido y enviado', type: 'success' })
      } else {
        const parentRes = await supabaseFetch<{ country_id: string | null }>(
          `posts?select=country_id&id=eq.${encodeURIComponent(id)}`,
          { single: true },
        )
        const parentCountryId = parentRes.data?.country_id
        const { data: revisionRow, error } = await supabaseFetch<{ id: string }>(`posts?select=id`, {
          method: 'POST',
          body: [{
            ...commonData,
            user_id: userId, status: 'revision', is_approved: false, parent_post_id: id,
            ...(parentCountryId ? { country_id: parentCountryId } : {}),
          }],
          single: true,
        })
        if (error) throw new Error(error.message)
        if (revisionRow?.id) {
          fetch('/api/posts/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId: revisionRow.id, event: 'create' }),
          }).catch(err => console.error('[edit post] audit call failed (revision clone create)', err))
        }
        setStatusMsg({ text: 'Cambios enviados a revisión', type: 'success' })
      }

      // Server write confirmed — drop the local draft so the restore
      // banner doesn't surface on the next mount.
      try { localStorage.removeItem(DRAFT_KEY_PREFIX + id) } catch {}

      // Sync the SDK's in-memory session with the cookie after a direct
      // PATCH. The write went through supabaseFetch (bypassing the SDK), so
      // nothing nudged GoTrueClient's cached JWT. After several consecutive
      // saves the SDK can keep holding an expiring token — UserHeader's
      // fetchProfile then returns 0 rows (RLS denies the stale JWT), isAdmin
      // falls to null, and the next client-side navigation renders a blank
      // header + React error #418. refreshSession() forces a re-read of the
      // cookie. Non-fatal: if the refresh fails we've still saved.
      try { await supabase.auth.refreshSession() } catch (refreshErr) {
        console.warn('[edit post] refreshSession post-save failed (non-fatal):', refreshErr)
      }

      setTimeout(() => router.push(isAdmin ? '/admin' : '/dashboard'), 2500)
    } catch (err) {
      // Log the actual error so you can tell a schema/RLS issue from the
      // generic 'sync error'. Common causes: tier CHECK constraint missing
      // 'elite'; user_id mismatch on a post the admin didn't own; a missing
      // column; validate-media aborted after its 10 s timeout; or the
      // Cloudinary upload hitting the 3-min xhr timeout.
      console.error('[edit post] update failed', err)
      const isAbort = err instanceof DOMException && err.name === 'AbortError'
      const detail = isAbort
        ? 'La validación tardó demasiado. Revisá la conexión y reintentá.'
        : err instanceof Error ? err.message : 'Error en la sincronización'
      setStatusMsg({ text: `${detail} — Tus cambios quedaron respaldados localmente (podés recargar y restaurar).`, type: 'error' })
    } finally {
      clearTimeout(stuckSaveTimer)
      setSaving(false)
    }
  }

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'var(--v-bg-base)', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <MarketplaceLoader variant="block" />
    </div>
  )

  return (
    <>
      <style>{`
        .ve-page { min-height: 100vh; background: var(--v-bg-base); color: var(--v-text-primary); padding-bottom: 8px; }
        .ve-container { max-width: 720px; margin: 0 auto; padding: 0 16px; }

        .ve-toast {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 100;
          padding: 13px 26px; border-radius: 999px;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11px; font-weight: 500; max-width: calc(100vw - 32px); text-align: center;
          pointer-events: none; box-shadow: 0 8px 32px rgba(0,0,0,0.45);
        }
        .ve-toast.error { border: 1px solid rgba(199,90,90,0.3); background: rgba(40,12,12,0.96); color: #e89898; }
        .ve-toast.success { border: 1px solid rgba(37, 99, 235,0.3); background: rgba(20,16,8,0.96); color: var(--v-accent); }

        .ve-stepper-wrap {
          position: sticky; top: 0; z-index: 40;
          background: rgba(8,8,8,0.92); backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(37, 99, 235,0.08);
        }
        .ve-stepper {
          max-width: 720px; margin: 0 auto;
          display: flex; gap: 6px; overflow-x: auto; padding: 11px 16px; scrollbar-width: none;
        }
        .ve-stepper::-webkit-scrollbar { display: none; }
        .ve-step {
          flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 13px 5px; border-radius: 999px; cursor: pointer; white-space: nowrap;
          border: 1px solid rgba(37, 99, 235,0.08); background: transparent;
          color: var(--v-text-tertiary);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10.5px; font-weight: 500; letter-spacing: .03em;
          transition: color .2s, background .2s, border-color .2s;
        }
        .ve-step-n {
          width: 17px; height: 17px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.06); color: var(--v-text-tertiary);
          font-size: 9px; font-weight: 600;
        }
        .ve-step.active { color: var(--v-accent); background: rgba(37, 99, 235,0.08); border-color: rgba(37, 99, 235,0.3); }
        .ve-step.active .ve-step-n { background: var(--v-accent); color: var(--v-bg-base); }

        .ve-head { padding: 26px 0 18px; }
        .ve-head h1 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: clamp(26px,5vw,34px); color: var(--v-accent);
          letter-spacing: -.01em; margin: 0 0 6px; line-height: 1.1;
        }
        .ve-head p {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11px; color: var(--v-text-tertiary); letter-spacing: .04em;
        }

        .ve-banner {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px; border-radius: 10px; margin-bottom: 20px;
        }
        .ve-banner.info {
          background: linear-gradient(135deg, rgba(37, 99, 235,0.08) 0%, rgba(37, 99, 235,0.02) 100%);
          border: 1px solid rgba(37, 99, 235,0.2);
        }
        .ve-banner.draft { background: rgba(37, 99, 235,0.08); border: 1px solid rgba(37, 99, 235,0.4); flex-wrap: wrap; }
        .ve-banner-ic {
          width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
          background: rgba(37, 99, 235,0.08); border: 1px solid rgba(37, 99, 235,0.22);
          color: var(--v-accent); display: flex; align-items: center; justify-content: center;
        }
        .ve-banner-ic svg { width: 14px; height: 14px; }
        .ve-banner-body { flex: 1; min-width: 0; }
        .ve-banner-ttl {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; font-weight: 500; color: var(--v-text-primary);
        }
        .ve-banner-sub {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary); margin-top: 2px;
        }
        .ve-banner-btn {
          background: transparent; border: none; cursor: pointer;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10.5px; font-weight: 600; color: var(--v-accent); letter-spacing: .04em;
        }
        .ve-banner-btn.solid { background: var(--v-accent); color: var(--v-bg-base); border-radius: 999px; padding: 7px 15px; }
        .ve-banner-btn.ghost { border: 1px solid rgba(37, 99, 235,0.3); border-radius: 999px; padding: 7px 15px; }

        .ve-form { display: flex; flex-direction: column; gap: 26px; }
        .ve-section { scroll-margin-top: 64px; }
        .ve-sec-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 12px; margin-bottom: 14px;
        }
        .ve-sec-head h3 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 15px; color: var(--v-accent);
          letter-spacing: .16em; text-transform: uppercase; margin: 0;
        }
        .ve-badge {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10px; font-weight: 600; letter-spacing: 0; text-transform: none;
          color: var(--v-accent); background: rgba(37, 99, 235,0.08);
          border: 1px solid rgba(37, 99, 235,0.22); border-radius: 999px;
          padding: 1px 8px; margin-left: 7px;
        }
        .ve-sec-count {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10px; color: var(--v-text-tertiary); letter-spacing: .04em;
        }

        .ve-locked-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .ve-locked {
          background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%);
          border: 1px solid rgba(37, 99, 235,0.08); border-radius: 10px; padding: 12px 14px;
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
        }
        .ve-locked-lbl {
          display: flex; align-items: center; gap: 6px;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 9px; color: var(--v-text-tertiary);
          letter-spacing: .14em; text-transform: uppercase; margin-bottom: 4px;
        }
        .ve-locked-lbl svg { width: 10px; height: 10px; }
        .ve-locked-val {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 17px; color: var(--v-text-primary); line-height: 1.1;
        }
        .ve-tier-chip {
          flex-shrink: 0; background: var(--v-accent); color: var(--v-bg-base);
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 10px; letter-spacing: .18em; text-transform: uppercase;
          padding: 4px 10px 3px; border-radius: 3px;
        }

        .ve-field { margin-bottom: 12px; }
        .ve-field label {
          display: block;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; font-weight: 500; color: var(--v-text-primary); margin-bottom: 7px;
        }
        .ve-field label .opt { color: var(--v-text-tertiary); font-weight: 400; }
        .ve-input-wrap {
          display: flex; align-items: center;
          background: var(--v-bg-elevated); border: 1px solid rgba(37, 99, 235,0.1);
          border-radius: 10px; transition: border-color .15s ease;
        }
        .ve-input-wrap:focus-within { border-color: var(--v-accent); }
        .ve-icon-left { padding-left: 13px; color: var(--v-accent); display: inline-flex; flex-shrink: 0; }
        .ve-icon-left svg { width: 14px; height: 14px; }
        .ve-input {
          flex: 1; min-width: 0; width: 100%; box-sizing: border-box;
          background: transparent; border: 0; outline: 0;
          padding: 12px 13px; color: var(--v-text-primary);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif; font-size: 13px;
        }
        .ve-input::placeholder { color: var(--v-text-tertiary); }
        select.ve-input { appearance: none; cursor: pointer; }
        /* Native dropdown opens on the OS layer with default light bg —
           text inherits the form's near-white color, so options end up
           white-on-white. Explicit background + color makes them legible
           in both themes (vars resolve per .dark / :root). */
        select.ve-input option { background: var(--v-bg-elevated); color: var(--v-text-primary); }
        .ve-textarea {
          width: 100%; box-sizing: border-box; resize: vertical; min-height: 110px;
          background: var(--v-bg-elevated); border: 1px solid rgba(37, 99, 235,0.1);
          border-radius: 10px; padding: 12px 13px; outline: none;
          color: var(--v-text-primary); line-height: 1.6;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif; font-size: 13px;
        }
        .ve-textarea:focus { border-color: var(--v-accent); }
        .ve-hint {
          margin-top: 6px;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary); line-height: 1.45;
        }
        .ve-counter {
          display: flex; justify-content: space-between; margin-top: 5px;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary);
        }
        .ve-counter b { color: var(--v-accent-light); font-weight: 600; }
        .ve-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        @media (max-width: 480px) { .ve-two-col { grid-template-columns: 1fr; } }

        .ve-search {
          display: flex; align-items: center; gap: 9px;
          background: var(--v-bg-elevated); border: 1px solid rgba(37, 99, 235,0.1);
          border-radius: 999px; padding: 9px 14px; margin-bottom: 10px;
        }
        .ve-search svg { width: 13px; height: 13px; color: var(--v-accent); flex-shrink: 0; }
        .ve-search input {
          flex: 1; min-width: 0; background: transparent; border: 0; outline: 0;
          color: var(--v-text-primary);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif; font-size: 13px;
        }
        .ve-search input::placeholder { color: var(--v-text-tertiary); }

        .ve-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .ve-chip {
          padding: 8px 13px 7px; border-radius: 999px; cursor: pointer;
          border: 1px solid rgba(37, 99, 235,0.1); background: transparent;
          color: var(--v-text-tertiary);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; font-weight: 400; transition: color .15s, background .15s, border-color .15s;
        }
        .ve-chip:hover { color: var(--v-text-primary); }
        .ve-chip.on {
          color: var(--v-accent); background: rgba(37, 99, 235,0.08);
          border-color: rgba(37, 99, 235,0.3); font-weight: 500;
        }
        .ve-chip-empty {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11px; color: var(--v-text-tertiary); padding: 8px 0;
        }

        .ve-cover {
          border: 1px solid rgba(37, 99, 235,0.1); background: var(--v-bg-elevated);
          border-radius: 10px; padding: 16px;
        }
        .ve-cover-drop {
          border: 1.5px dashed rgba(37, 99, 235,0.3); border-radius: 10px;
          padding: 20px; text-align: center; cursor: pointer;
        }

        .ve-sticky {
          position: sticky; bottom: 0; z-index: 30;
          margin: 6px -16px 0; padding: 14px 16px 18px;
          background: linear-gradient(180deg, rgba(8,8,8,0) 0%, rgba(8,8,8,0.95) 32%, var(--v-bg-base) 100%);
        }
        .ve-cta {
          width: 100%; padding: 15px 18px 14px;
          background: var(--v-accent); color: var(--v-bg-base);
          border: none; border-radius: 999px; cursor: pointer;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-weight: 600; font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        }
        .ve-cta svg { width: 13px; height: 13px; }
        .ve-cta:disabled { background: rgba(37, 99, 235,0.18); color: var(--v-text-tertiary); cursor: not-allowed; }
      `}</style>

      {saving && <MarketplaceLoader variant="fullscreen" ariaLabel="Guardando cambios" />}

      {editorSrc !== null && editorTarget !== null && (
        <PhotoEditorModal
          src={editorSrc}
          onSave={(dataUrl) => {
            if (editorTarget.kind === 'new') {
              const prevDisplayUrl = newImagePreviews[editorTarget.idx]
              setEditedNewImages(prev => ({ ...prev, [editorTarget.idx]: dataUrl }))
              if (coverUrl === prevDisplayUrl) setCoverUrl(dataUrl)
              if (profilePhotoUrl === prevDisplayUrl) setProfilePhotoUrl(dataUrl)
            } else {
              setExistingImageUrls(prev => prev.map(u => u === editorTarget.url ? dataUrl : u))
              if (coverUrl === editorTarget.url) setCoverUrl(dataUrl)
              if (profilePhotoUrl === editorTarget.url) setProfilePhotoUrl(dataUrl)
            }
            setEditorSrc(null); setEditorTarget(null)
          }}
          onClose={() => { setEditorSrc(null); setEditorTarget(null) }}
        />
      )}


      <div className="ve-page">

        {statusMsg && <div className={`ve-toast ${statusMsg.type}`}>{statusMsg.text}</div>}

        <div className="ve-stepper-wrap">
          <div className="ve-stepper">
            {VE_STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`ve-step ${activeSection === s.id ? 'active' : ''}`}
                onClick={() => scrollToSection(s.id)}
              >
                <span className="ve-step-n">{i + 1}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ve-container">
          <div className="ve-head">
            <h1>{isAdmin ? 'Modo auditoría' : originalStatus === 'rejected' ? 'Corregir anuncio' : 'Editar publicación'}</h1>
            <p>{isAdmin ? 'Edición directa, sin pasar por aprobación' : originalStatus === 'rejected' ? 'Corregí lo señalado y reenviá a revisión' : 'Tus cambios se envían a revisión antes de publicarse'}</p>
          </div>

          {pendingDraft ? (
            <div className="ve-banner draft">
              <span className="ve-banner-ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.4 14.5a8.5 8.5 0 1 1-1.4-9.5" /><path d="M22 4v6h-6" /></svg>
              </span>
              <div className="ve-banner-body">
                <div className="ve-banner-ttl">Borrador local detectado</div>
                <div className="ve-banner-sub">{draftBannerAgeMin !== null ? `Guardado hace ${draftBannerAgeMin} min · podés restaurarlo` : 'Hay cambios sin guardar de una sesión previa'}</div>
              </div>
              <button type="button" className="ve-banner-btn solid" onClick={restoreDraft}>Restaurar</button>
              <button type="button" className="ve-banner-btn ghost" onClick={discardDraft}>Descartar</button>
            </div>
          ) : (
            <div className="ve-banner info">
              <span className="ve-banner-ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.4 14.5a8.5 8.5 0 1 1-1.4-9.5" /><path d="M22 4v6h-6" /></svg>
              </span>
              <div className="ve-banner-body">
                <div className="ve-banner-ttl">Guardado automático activo</div>
                <div className="ve-banner-sub">Tus cambios se respaldan localmente cada pocos segundos</div>
              </div>
            </div>
          )}

          <form onSubmit={handleUpdate} className="ve-form">

            {isAdmin && postUserId && adminUserId && postUserId !== adminUserId && (
              <AdminVerifyForUser
                userId={postUserId}
                currentStatus={postVerificationStatus}
                onSuccess={() => setPostVerificationStatus('approved')}
              />
            )}

            <section id="ve-sec-basico" data-ve-section="basico" className="ve-section">
              <div className="ve-sec-head">
                <h3>Datos del perfil</h3>
                {!isAdmin && <span className="ve-sec-count">No editables</span>}
              </div>
              {isAdmin ? (
                <>
                  <div className="ve-field">
                    <label>Nombre artístico</label>
                    <div className="ve-input-wrap">
                      <input className="ve-input" type="text" value={title} onChange={e => setTitle(e.target.value)} required />
                    </div>
                  </div>
                  <div className="ve-two-col">
                    <div className="ve-field">
                      <label>Categoría</label>
                      <div className="ve-input-wrap">
                        <select className="ve-input" value={category} onChange={e => setCategory(e.target.value)}>
                          <option value="">Seleccionar…</option>
                          {CATEGORIES.filter(c => activeCategories.has(c.id) || c.id === category).map(c => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="ve-field">
                      <label>Nivel</label>
                      <div className="ve-input-wrap">
                        <select className="ve-input" value={tier} onChange={e => setTier(e.target.value)}>
                          <option value="">Seleccionar…</option>
                          {TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="ve-field" style={{ marginBottom: 0 }}>
                    <label>País</label>
                    <div className="ve-input-wrap">
                      <select className="ve-input" value={city} onChange={e => setCity(e.target.value)}>
                        <option value={city}>{COUNTRY_LABEL}</option>
                      </select>
                    </div>
                  </div>
                </>
              ) : (
                <div className="ve-locked-grid">
                  <div className="ve-locked" style={{ gridColumn: '1 / -1' }}>
                    <div>
                      <div className="ve-locked-lbl">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                        Nombre artístico
                      </div>
                      <div className="ve-locked-val">{title || '—'}</div>
                    </div>
                    {tier && <span className="ve-tier-chip">{TIERS.find(t => t.id === tier)?.label || tier}</span>}
                  </div>
                  <div className="ve-locked">
                    <div>
                      <div className="ve-locked-lbl">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                        Categoría
                      </div>
                      <div className="ve-locked-val">{CATEGORIES.find(c => c.id === category)?.label || '—'}</div>
                    </div>
                  </div>
                  <div className="ve-locked">
                    <div>
                      <div className="ve-locked-lbl">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                        País
                      </div>
                      <div className="ve-locked-val">{COUNTRY_LABEL}</div>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section id="ve-sec-contacto" data-ve-section="contacto" className="ve-section">
              <div className="ve-sec-head"><h3>Contacto</h3></div>
              <div className="ve-field">
                <label>WhatsApp</label>
                <div className="ve-input-wrap">
                  <span className="ve-icon-left">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 3.5A11 11 0 0 0 3 18.5L2 22l3.5-1A11 11 0 1 0 20.5 3.5z" /></svg>
                  </span>
                  <input
                    className="ve-input" type="tel" value={whatsapp} maxLength={15} placeholder="+5491126783554"
                    onChange={e => setWhatsapp(e.target.value.replace(/[^\d+]/g, ''))} required
                  />
                </div>
                <p className="ve-hint">Formato +CCPNNNNNNNNN · máximo 14 caracteres con el +</p>
              </div>
              <div className="ve-field" style={{ marginBottom: 0 }}>
                <label>Telegram <span className="opt">(opcional)</span></label>
                <div className="ve-input-wrap">
                  <span className="ve-icon-left">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 4 3 11l6 2.5L11 20l3.5-4 5 3.5L21 4z" /></svg>
                  </span>
                  <input
                    className="ve-input" type="tel" value={telegram} maxLength={15} placeholder="+5491126783554"
                    onChange={e => setTelegram(e.target.value.replace(/[^\d+]/g, ''))}
                  />
                </div>
                <p className="ve-hint">Si lo dejás vacío, el botón Telegram no aparece en la publicación.</p>
              </div>

              <div className="ve-sec-head" style={{ marginTop: '20px' }}>
                <h3>Precio</h3>
                <span className="ve-sec-count">USD principal · ARS/EUR opcionales</span>
              </div>
              <div className="ve-two-col">
                <div className="ve-field" style={{ marginBottom: 0 }}>
                  <label>USD</label>
                  <div className="ve-input-wrap">
                    <input className="ve-input" type="text" inputMode="numeric" value={priceUsd} placeholder="200"
                      onChange={e => setPriceUsd(formatThousands(e.target.value))} required />
                  </div>
                </div>
                <div className="ve-field" style={{ marginBottom: 0 }}>
                  <label>ARS <span className="opt">(opcional)</span></label>
                  <div className="ve-input-wrap">
                    <input className="ve-input" type="text" inputMode="numeric" value={price} placeholder="150.000"
                      onChange={e => setPrice(formatThousands(e.target.value))} />
                  </div>
                </div>
              </div>
              <div className="ve-field" style={{ marginTop: '10px', marginBottom: 0 }}>
                <label>EUR <span className="opt">(opcional)</span></label>
                <div className="ve-input-wrap">
                  <input className="ve-input" type="text" inputMode="numeric" value={priceEur} placeholder="180"
                    onChange={e => setPriceEur(formatThousands(e.target.value))} />
                </div>
              </div>
            </section>

            {(tier === 'gold' || tier === 'elite') && isAdmin && (
              <section className="ve-section">
                <div className="ve-sec-head">
                  <h3>Video de portada</h3>
                  <span className="ve-sec-count">Gold · Elite</span>
                </div>
                <div className="ve-cover">
                  {coverVideoPreview ? (
                    <div style={{ position: 'relative', maxWidth: '200px' }}>
                      <video src={coverVideoPreview} autoPlay loop muted playsInline
                        style={{ width: '100%', borderRadius: '8px', border: '1px solid rgba(37, 99, 235,0.3)' }} />
                      <button type="button" onClick={() => { setCoverVideo(null); setCoverVideoPreview(null) }}
                        style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(8,8,8,0.78)', border: 'none', color: '#e89898', width: 24, height: 24, borderRadius: '50%', cursor: 'pointer', fontSize: 12 }}>✕</button>
                    </div>
                  ) : (
                    <div className="ve-cover-drop" onClick={() => coverVideoRef.current?.click()}>
                      <p className="ve-hint" style={{ marginTop: 0, fontSize: '12px', color: 'var(--v-text-primary)' }}>Tocá para subir el video de portada</p>
                      <p className="ve-hint">MP4 · máx. 50 MB · formato vertical recomendado</p>
                    </div>
                  )}
                  <input ref={coverVideoRef} type="file" accept="video/mp4,video/mov,video/quicktime" style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      if (file.size > 50 * 1024 * 1024) { setStatusMsg({ text: 'El video no puede superar 50MB', type: 'error' }); return }
                      setCoverVideo(file)
                      setCoverVideoPreview(URL.createObjectURL(file))
                    }} />
                </div>
              </section>
            )}

            <section id="ve-sec-fotos" data-ve-section="fotos" className="ve-section">
              <MediaUploader
                isAdmin={isAdmin}
                tier={tier}
                tierLimits={tierLimits}
                getRootProps={getRootProps}
                getInputProps={getInputProps}
                isDragActive={isDragActive}
                existingImageUrls={existingImageUrls}
                setExistingImageUrls={setExistingImageUrls}
                newImageFiles={newImageFiles}
                setNewImageFiles={setNewImageFiles}
                newImagePreviews={newImagePreviews}
                setNewImagePreviews={setNewImagePreviews}
                editedNewImages={editedNewImages}
                setEditedNewImages={setEditedNewImages}
                existingVideoUrls={existingVideoUrls}
                setExistingVideoUrls={setExistingVideoUrls}
                newVideoFiles={newVideoFiles}
                setNewVideoFiles={setNewVideoFiles}
                existingAudioUrl={existingAudioUrl}
                setExistingAudioUrl={setExistingAudioUrl}
                existingAudioFilename={existingAudioFilename}
                setExistingAudioFilename={setExistingAudioFilename}
                newAudioFile={newAudioFile}
                setNewAudioFile={setNewAudioFile}
                coverUrl={coverUrl}
                setCoverUrl={setCoverUrl}
                profilePhotoUrl={profilePhotoUrl}
                setProfilePhotoUrl={setProfilePhotoUrl}
                setEditorSrc={setEditorSrc}
                setEditorTarget={setEditorTarget}
                uploadProgress={uploadProgress}
              />
            </section>

            <section id="ve-sec-descripcion" data-ve-section="descripcion" className="ve-section">
              <div className="ve-sec-head"><h3>Descripción</h3></div>
              <div style={{ position: 'relative' }}>
                <textarea
                  ref={descRef}
                  className="ve-textarea"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  maxLength={1500}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(v => !v)}
                  style={{ position: 'absolute', right: '10px', bottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}
                  title="Insertar emoji"
                >😊</button>
                {showEmojiPicker && (
                  <div ref={emojiPickerRef} style={{ position: 'absolute', zIndex: 1000, bottom: '44px', right: 0, maxWidth: 'min(350px, calc(100vw - 32px))', overflow: 'hidden' }}>
                    <EmojiPicker
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      theme={'dark' as any}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      emojiStyle={'native' as any}
                      lazyLoadEmojis
                      onEmojiClick={(emojiData) => {
                        const ta = descRef.current
                        if (!ta) {
                          const newVal = description + emojiData.emoji
                          if (newVal.length <= 1500) setDescription(newVal)
                          setShowEmojiPicker(false)
                          return
                        }
                        const pos = ta.selectionStart ?? description.length
                        const newVal = description.slice(0, pos) + emojiData.emoji + description.slice(pos)
                        if (newVal.length <= 1500) {
                          setDescription(newVal)
                          setTimeout(() => { ta.selectionStart = pos + emojiData.emoji.length; ta.selectionEnd = pos + emojiData.emoji.length; ta.focus() }, 0)
                        }
                        setShowEmojiPicker(false)
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="ve-counter">
                <span>Mín. 80 caracteres</span>
                <span><b>{description.length}</b> / 1500</span>
              </div>

            </section>

            <section id="ve-sec-atributos" data-ve-section="atributos" className="ve-section">
              <div className="ve-sec-head">
                <h3>Detalles del anuncio</h3>
                <span className="ve-sec-count">Completá los datos del servicio</span>
              </div>
              <ListingAttributeFields
                isAdmin={isAdmin}
                value={attributes}
                onChange={setAttribute}
              />
            </section>

            <section id="ve-sec-ubicacion" data-ve-section="ubicacion" className="ve-section">
              <GeoCascadePicker geo={geo} />
            </section>

            <div className="ve-sticky">
              <button type="submit" className="ve-cta" disabled={saving}>
                {saving
                  ? 'Procesando…'
                  : isAdmin ? 'Actualizar publicación' : originalStatus === 'rejected' ? 'Reenviar a revisión' : 'Enviar a revisión'}
                {!saving && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
