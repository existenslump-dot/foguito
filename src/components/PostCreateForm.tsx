'use client'
import { supabase } from '@/lib/supabase/client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { CATEGORIES, TIERS } from '@/lib/categories'
import { fetchTierSettings, toActiveSet, DEFAULT_ACTIVE_TIER_SLUGS } from '@/lib/tier-settings'
import { useGeoCascade } from '@/hooks/useGeoCascade'
import { COUNTRY_SLUG, MARKET_CURRENCY } from '@/config/marketplace.config'
import ListingAttributeFields, { type AttributeMap, type AttributeValue } from '@/components/dashboard/ListingAttributeFields'
import GeoCascadePicker from '@/components/dashboard/GeoCascadePicker'
import MediaUploader, { type EditorTarget } from '@/components/dashboard/MediaUploader'
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
import { resolvePostDurationDays } from '@/lib/subscriptions'
import dynamic from 'next/dynamic'
import PhotoEditorModal from '@/components/PhotoEditorModal'
import MarketplaceLoader from '@/components/MarketplaceLoader'
import { CLOUDINARY_UPLOAD_PRESET, cloudinaryUploadUrl } from '@/lib/cloudinary.client'

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false })

const TIER_LIMITS: Record<string, { photos: number; videos: number; audios: number }> = {
  elite:    { photos: 18, videos: 3, audios: 1 },
  gold:   { photos: 15, videos: 2, audios: 1 },
  silver:   { photos: 12, videos: 1, audios: 0 },
  bronze:   { photos: 9,  videos: 0, audios: 0 },
  basic: { photos: 6,  videos: 0, audios: 0 },
}

export type PostCreateFormMode = 'admin' | 'self-service'

interface Props {
  mode: PostCreateFormMode
}

export default function PostCreateForm({ mode }: Props) {
  const isAdminMode = mode === 'admin'
  const router = useRouter()
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [userId, setUserId]       = useState<string | null>(null)
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set(['mujer','perfil','hombre','profesional']))
  const [activeTierSlugs, setActiveTierSlugs] = useState<Set<string>>(new Set(DEFAULT_ACTIVE_TIER_SLUGS))
  const [showInactiveTiers, setShowInactiveTiers] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{text: string, type: 'success' | 'error'} | null>(null)

  type TargetProfile = {
    id: string
    full_name: string | null
    email: string
    verification_status: string | null
  }
  const [targetUserId, setTargetUserId] = useState<string | null>(null)
  const [targetProfile, setTargetProfile] = useState<TargetProfile | null>(null)
  const [targetSearchQuery, setTargetSearchQuery] = useState('')
  const [targetSearchResults, setTargetSearchResults] = useState<TargetProfile[]>([])
  const [targetSearching, setTargetSearching] = useState(false)

  const [category, setCategory] = useState('mujer')
  const [tier, setTier]         = useState<string>(mode === 'admin' ? '' : 'bronze')
  const [title, setTitle]           = useState('')
  const [price, setPrice]           = useState('')
  const [priceUsd, setPriceUsd]     = useState('')
  const [priceEur, setPriceEur]     = useState('')
  const [description, setDescription] = useState('')
  const [city, setCity]             = useState('buenosaires')
  const [whatsapp, setWhatsapp]     = useState('')
  const [telegram, setTelegram]     = useState('')

  const [attributes, setAttributes] = useState<AttributeMap>({})
  const setAttribute = (key: string, val: AttributeValue) =>
    setAttributes(prev => ({ ...prev, [key]: val }))
  const geo = useGeoCascade({ countrySlug: COUNTRY_SLUG })


  const [imageFiles, setImageFiles]       = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [editedImages, setEditedImages]   = useState<Record<number, string>>({})
  const [videoFiles, setVideoFiles]       = useState<File[]>([])
  const [videoPreviews, setVideoPreviews] = useState<string[]>([])
  const [audioFile, setAudioFile]         = useState<File | null>(null)
  const [coverUrl, setCoverUrl]           = useState<string | null>(null)
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null)
  const [coverVideo, setCoverVideo]             = useState<File | null>(null)
  const [coverVideoPreview, setCoverVideoPreview] = useState<string | null>(null)
  const coverVideoRef = useRef<HTMLInputElement>(null)

  const [uploadProgress, setUploadProgress] = useState<Record<number, number>>({})
  const [editorSrc, setEditorSrc]         = useState<string | null>(null)
  const [editorTarget, setEditorTarget]   = useState<EditorTarget | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const descRef      = useRef<HTMLTextAreaElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)

  const VC_STEPS = [
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
    document.getElementById(`vc-sec-${sid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    fetchUser()
    return () => {
      imagePreviews.forEach(url => URL.revokeObjectURL(url))
      videoPreviews.forEach(url => URL.revokeObjectURL(url))
      if (coverVideoPreview?.startsWith('blob:')) URL.revokeObjectURL(coverVideoPreview)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    const q = targetSearchQuery.trim()
    if (q.length < 2) {
      setTargetSearchResults([])
      return
    }
    let cancelled = false
    const tid = setTimeout(async () => {
      setTargetSearching(true)
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, verification_status')
        .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(10)
      if (cancelled) return
      if (error) {
        console.error('[admin/create] target search failed', error)
        setTargetSearchResults([])
      } else {
        setTargetSearchResults((data as TargetProfile[]) ?? [])
      }
      setTargetSearching(false)
    }, 300)
    return () => { cancelled = true; clearTimeout(tid) }
  }, [targetSearchQuery])

  async function fetchUser() {
    const timeout = setTimeout(() => {
      setLoading(false)
      setStatusMsg({ text: 'Timeout cargando el formulario (8s). Recargá la página.', type: 'error' })
    }, 8000)
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser()
      if (authErr || !user) {
        router.push('/ingresar')
        return
      }
      setUserId(user.id)

      const { data: cats } = await supabase.from('categories').select('id, active')
      if (cats) {
        const activeIds = new Set(cats.filter(c => c.active).map(c => c.id))
        if (activeIds.size > 0) setActiveCategories(activeIds)
      }

      const tierRows = await fetchTierSettings()
      setActiveTierSlugs(toActiveSet(tierRows))
    } catch (err) {
      console.error('[create] fetchUser failed:', err)
      setStatusMsg({ text: 'Error al cargar el formulario. Recargá la página.', type: 'error' })
    } finally {
      clearTimeout(timeout)
      setLoading(false)
    }
  }

  const showNotification = (text: string, type: 'success' | 'error') => {
    setStatusMsg({ text, type })
    setTimeout(() => setStatusMsg(null), 4000)
  }

  const processImageFiles = useCallback((files: File[]) => {
    const maxPhotos = TIER_LIMITS[tier]?.photos ?? 6
    if (imageFiles.length + files.length > maxPhotos)
      return showNotification(`Límite de ${maxPhotos} fotos para este tier`, 'error')
    // MIME whitelist + extension sniff — `accept: image/*` matches SVG,
    // which carries inline <script> and turns into stored XSS once
    // Cloudinary serves it back. Validate every file so a manual drag-
    // drop that bypasses the OS picker still gets caught.
    const valid: File[] = []
    for (const f of files) {
      const r = validateImageFile(f)
      if (!r.ok) { showNotification(r.reason, 'error'); continue }
      valid.push(f)
    }
    if (valid.length === 0) return
    const previews = valid.map(f => URL.createObjectURL(f))
    setImageFiles(prev => [...prev, ...valid])
    setImagePreviews(prev => [...prev, ...previews])
    if (!coverUrl && previews.length > 0) setCoverUrl(previews[0])
  }, [imageFiles, tier, coverUrl])

  const processVideoFiles = useCallback((files: File[]) => {
    const maxVideos = TIER_LIMITS[tier]?.videos ?? 1
    if (videoFiles.length + files.length > maxVideos)
      return showNotification(`Límite de ${maxVideos} videos para este tier`, 'error')
    const valid: File[] = []
    for (const f of files) {
      const r = validateVideoFile(f)
      if (!r.ok) { showNotification(r.reason, 'error'); continue }
      valid.push(f)
    }
    if (valid.length === 0) return
    setVideoFiles(prev => [...prev, ...valid])
    setVideoPreviews(prev => [...prev, ...valid.map(f => URL.createObjectURL(f))])
  }, [videoFiles, tier])

  const uploadFile = useCallback(async (file: File, type: 'image' | 'video' | 'auto', idx?: number): Promise<string> => {
    let fileToUpload = file
    if (type === 'image') {
      try {
        fileToUpload = await imageCompression(file, {
          maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true,
          onProgress: idx !== undefined ? (p: number) => setUploadProgress(prev => ({ ...prev, [idx]: p })) : undefined,
        }) as File
      } catch { /* keep original */ }
    }
    return new Promise((resolve, reject) => {
      const formData = new FormData()
      formData.append('file', fileToUpload)
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', cloudinaryUploadUrl(type))
      if (idx !== undefined && type !== 'image') {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(prev => ({ ...prev, [idx]: Math.round((e.loaded / e.total) * 100) }))
        }
      }
      xhr.onload = () => {
        if (xhr.status === 200) resolve(JSON.parse(xhr.responseText).secure_url)
        else reject(new Error('Upload failed'))
      }
      xhr.onerror = () => reject(new Error('Network error'))
      xhr.send(formData)
    })
  }, [])

  const formatThousands = (val: string) => {
    const digits = val.replace(/\D/g, '')
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  }

  const tierLimits = TIER_LIMITS[tier] ?? { photos: 6, videos: 0, audios: 0 }

  const onDrop = useCallback((files: File[]) => {
    const imgs = files.filter(f => f.type.startsWith('image/'))
    const vids = files.filter(f => f.type.startsWith('video/'))
    const auds = files.filter(f => f.type.startsWith('audio/'))
    if (imgs.length) processImageFiles(imgs)
    if (vids.length) processVideoFiles(vids)
    if (auds.length && !audioFile) {
      const r = validateAudioFile(auds[0])
      if (!r.ok) showNotification(r.reason, 'error')
      else setAudioFile(auds[0])
    }
  }, [processImageFiles, processVideoFiles, audioFile])

  const dropzoneAccept: Record<string, string[]> = dropzoneImageAccept()
  if (tierLimits.videos > 0) Object.assign(dropzoneAccept, dropzoneVideoAccept())
  if (tierLimits.audios > 0) Object.assign(dropzoneAccept, dropzoneAudioAccept())
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: dropzoneAccept,
    onDrop,
  })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isAdminMode) {
      if (!targetUserId || !targetProfile) {
        return showNotification('Seleccioná la anunciante representada antes de crear', 'error')
      }
      if (targetProfile.verification_status !== 'approved') {
        return showNotification(
          'KYC pendiente: aprobá la verificación de esta anunciante en /admin antes de crear publicación',
          'error',
        )
      }
    }
    if (isAdminMode) {
      if (!category) return showNotification('Selecciona una categoría', 'error')
      if (!tier)     return showNotification('Selecciona un tier', 'error')
    }
    if (!coverUrl) return showNotification('Selecciona una portada', 'error')
    if (!userId) return

    await runCreate()
  }

  const runCreate = async () => {
    if (!coverUrl || !userId) return
    if (isAdminMode && (!targetUserId || !targetProfile)) return
    setSaving(true)
    setUploadProgress({})

    // Track every URL we upload during this flow. If the Supabase INSERT at
    // the end fails, we POST this list to /api/media/cleanup so Cloudinary
    // doesn't accumulate orphaned files (previously: failed inserts left
    // media leaking forever, costing quota + exposing unused assets).
    const uploadedUrls: string[] = []

    try {
      const valRes = await fetch('/api/posts/validate-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier,
          photoCount: imageFiles.length,
          videoCount: videoFiles.length,
          audioCount: audioFile ? 1 : 0,
        }),
      })
      if (!valRes.ok) {
        const { error } = await valRes.json()
        showNotification(error || 'Error de validación de medios', 'error')
        return
      }

      const uploadedImgs = await Promise.all(imageFiles.map(async (f, i) => {
        if (editedImages[i]) {
          const res = await fetch(editedImages[i])
          const blob = await res.blob()
          const edited = new File([blob], f.name, { type: 'image/jpeg' })
          return uploadFile(edited, 'image', i)
        }
        return uploadFile(f, 'image', i)
      }))
      uploadedUrls.push(...uploadedImgs)

      let finalImgs: string[] = []
      const coverIdx = imagePreviews.indexOf(coverUrl)
      if (coverIdx !== -1) {
        finalImgs = [uploadedImgs[coverIdx], ...uploadedImgs.filter((_, i) => i !== coverIdx)]
      } else {
        finalImgs = uploadedImgs
      }

      let finalProfileUrl: string | null = null
      if (profilePhotoUrl) {
        let matchedIdx = imagePreviews.indexOf(profilePhotoUrl)
        if (matchedIdx === -1) {
          for (const [k, v] of Object.entries(editedImages)) {
            if (v === profilePhotoUrl) { matchedIdx = parseInt(k); break }
          }
        }
        if (matchedIdx !== -1) finalProfileUrl = uploadedImgs[matchedIdx]
      }

      const uploadedVids = await Promise.all(videoFiles.map(f => uploadFile(f, 'video')))
      uploadedUrls.push(...uploadedVids)

      const uploadedAudio = audioFile ? await uploadFile(audioFile, 'auto') : ''
      if (uploadedAudio) uploadedUrls.push(uploadedAudio)

      let coverVideoUrl = ''
      if (coverVideo && (tier === 'gold' || tier === 'elite')) {
        coverVideoUrl = await uploadFile(coverVideo, 'video')
        uploadedUrls.push(coverVideoUrl)
      }

      const rawPrice = parseInt(price.replace(/\D/g, '')) || 0

      const postSlug = slugifyTitle(title)
      // NOTE: `approved_at` column doesn't exist in posts schema (only
      // `is_approved` boolean) — don't add it to the insert.

      // Geo: resolve country_id so new posts show up in the feed (filter is
      // country_id-based).
      const { data: countryRow } = await supabase
        .from('countries').select('id').eq('slug', COUNTRY_SLUG).single()
      const countryId = countryRow?.id ?? null

      const durationDays = isAdminMode
        ? await resolvePostDurationDays(supabase, targetUserId)
        : 30
      const nowIso     = new Date().toISOString()
      const expiresIso = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString()

      const { data: createdPost, error } = await supabase.from('posts').insert([{
        title, description, price: rawPrice, currency: MARKET_CURRENCY,
        whatsapp_number: whatsapp,
        telegram_number: telegram || null,
        ...(countryId ? { country_id: countryId } : {}),
        ...(postSlug ? { post_slug: postSlug } : {}),
        image_urls: finalImgs, video_urls: uploadedVids,
        audio_url: uploadedAudio, audio_filename: audioFile ? audioFile.name : '',
        user_id: isAdminMode ? targetUserId : userId,
        status: isAdminMode ? 'published' : 'pending',
        is_approved: isAdminMode ? true : false,
        ...(isAdminMode ? { published_at: nowIso, expires_at: expiresIso } : {}),
        category, tier,
        attributes,
        ...(priceUsd ? { price_usd: parseInt(priceUsd.replace(/\D/g, '')) } : {}),
        ...(priceEur ? { price_eur: parseInt(priceEur.replace(/\D/g, '')) } : {}),
        localidad: [geo.labels.barrio, geo.labels.comuna, geo.labels.provincia].filter(Boolean).join(', ') || null,
        ...(geo.provinciaId ? { provincia_id: geo.provinciaId } : {}),
        ...(geo.comunaId    ? { comuna_id:    geo.comunaId    } : {}),
        ...(geo.barrioId    ? { barrio_id:    geo.barrioId    } : {}),
        ...(coverVideoUrl ? { cover_video_url: coverVideoUrl } : {}),
        ...(finalProfileUrl ? { profile_photo_url: finalProfileUrl } : {}),
      }]).select('id').single()

      if (error) {
        if (error.code === '23505' && error.message?.includes('posts_one_active_per_user')) {
          throw new Error('Ya tenés una publicación activa. Editá o pausá la actual antes de crear otra.')
        }
        throw new Error(error.message || JSON.stringify(error))
      }

      if (createdPost?.id) {
        fetch('/api/posts/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId: createdPost.id, event: 'create' }),
        }).catch(err => console.error('[admin/create] audit call failed', err))
      }

      // At this point the post row exists — uploaded media is now owned by
      // a real DB record, so we clear the rollback buffer. If something
      // fails AFTER this point (e.g. router.push), it's a UX blip, not a
      // data integrity issue.
      uploadedUrls.length = 0

      showNotification(
        isAdminMode
          ? 'Publicación creada y publicada'
          : 'Publicación enviada — será revisada por un moderador en 24-48 h',
        'success',
      )
      setTimeout(() => router.push(isAdminMode ? '/admin' : '/dashboard'), isAdminMode ? 1500 : 2000)
    } catch (err) {
      if (uploadedUrls.length > 0) {
        void fetch('/api/media/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: uploadedUrls }),
        }).catch(cleanupErr => {
          console.warn('[create] cleanup failed:', cleanupErr)
        })
      }
      showNotification('Error al crear la publicación: ' + (err instanceof Error ? err.message : String(err)), 'error')
    } finally {
      // finally{} is the backstop — the success path leaves saving=true
      // so the loader stays visible through the 1.5s redirect, but any
      // exception on the way (validation fail, Cloudinary reject, Supabase
      // throw) must always clear it so the form isn't trapped.
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
        .vc-page { min-height: 100vh; background: var(--v-bg-base); color: var(--v-text-primary); padding-bottom: 8px; }
        .vc-container { max-width: 720px; margin: 0 auto; padding: 0 16px; }

        .vc-toast {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 100;
          padding: 13px 26px; border-radius: 999px;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11px; font-weight: 500; max-width: calc(100vw - 32px); text-align: center;
          pointer-events: none; box-shadow: 0 8px 32px rgba(0,0,0,0.45);
        }
        .vc-toast.error { border: 1px solid rgba(199,90,90,0.3); background: rgba(40,12,12,0.96); color: #e89898; }
        .vc-toast.success { border: 1px solid rgba(37, 99, 235,0.3); background: rgba(20,16,8,0.96); color: var(--v-accent); }

        .vc-stepper-wrap {
          position: sticky; top: 0; z-index: 40;
          background: rgba(8,8,8,0.92); backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(37, 99, 235,0.08);
        }
        .vc-stepper {
          max-width: 720px; margin: 0 auto;
          display: flex; gap: 6px; overflow-x: auto; padding: 11px 16px; scrollbar-width: none;
        }
        .vc-stepper::-webkit-scrollbar { display: none; }
        .vc-step {
          flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 13px 5px; border-radius: 999px; cursor: pointer; white-space: nowrap;
          border: 1px solid rgba(37, 99, 235,0.08); background: transparent;
          color: var(--v-text-tertiary);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10.5px; font-weight: 500; letter-spacing: .03em;
          transition: color .2s, background .2s, border-color .2s;
        }
        .vc-step-n {
          width: 17px; height: 17px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.06); color: var(--v-text-tertiary);
          font-size: 9px; font-weight: 600;
        }
        .vc-step.active { color: var(--v-accent); background: rgba(37, 99, 235,0.08); border-color: rgba(37, 99, 235,0.3); }
        .vc-step.active .vc-step-n { background: var(--v-accent); color: var(--v-bg-base); }

        .vc-head { padding: 26px 0 18px; }
        .vc-head h1 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: clamp(26px,5vw,34px); color: var(--v-accent);
          letter-spacing: -.01em; margin: 0 0 6px; line-height: 1.1;
        }
        .vc-head p {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11px; color: var(--v-text-tertiary); letter-spacing: .04em; line-height: 1.5;
        }

        .vc-form { display: flex; flex-direction: column; gap: 26px; }
        .vc-section { scroll-margin-top: 64px; }
        .vc-sec-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 12px; margin-bottom: 14px;
        }
        .vc-sec-head h3 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 15px; color: var(--v-accent);
          letter-spacing: .16em; text-transform: uppercase; margin: 0;
        }
        .vc-badge {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10px; font-weight: 600; letter-spacing: 0; text-transform: none;
          color: var(--v-accent); background: rgba(37, 99, 235,0.08);
          border: 1px solid rgba(37, 99, 235,0.22); border-radius: 999px;
          padding: 1px 8px; margin-left: 7px;
        }
        .vc-sec-count {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10px; color: var(--v-text-tertiary); letter-spacing: .04em;
        }

        .vc-field { margin-bottom: 12px; }
        .vc-field label {
          display: block;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; font-weight: 500; color: var(--v-text-primary); margin-bottom: 7px;
        }
        .vc-field label .opt { color: var(--v-text-tertiary); font-weight: 400; }
        .vc-input-wrap {
          display: flex; align-items: center;
          background: var(--v-bg-elevated); border: 1px solid rgba(37, 99, 235,0.1);
          border-radius: 10px; transition: border-color .15s ease;
        }
        .vc-input-wrap:focus-within { border-color: var(--v-accent); }
        .vc-icon-left { padding-left: 13px; color: var(--v-accent); display: inline-flex; flex-shrink: 0; }
        .vc-icon-left svg { width: 14px; height: 14px; }
        .vc-input {
          flex: 1; min-width: 0; width: 100%; box-sizing: border-box;
          background: transparent; border: 0; outline: 0;
          padding: 12px 13px; color: var(--v-text-primary);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif; font-size: 13px;
        }
        .vc-input::placeholder { color: var(--v-text-tertiary); }
        select.vc-input { appearance: none; cursor: pointer; }
        select.vc-input option { background: var(--v-bg-elevated); color: var(--v-text-primary); }
        .vc-textarea {
          width: 100%; box-sizing: border-box; resize: vertical; min-height: 110px;
          background: var(--v-bg-elevated); border: 1px solid rgba(37, 99, 235,0.1);
          border-radius: 10px; padding: 12px 13px; outline: none;
          color: var(--v-text-primary); line-height: 1.6;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif; font-size: 13px;
        }
        .vc-textarea:focus { border-color: var(--v-accent); }
        .vc-hint {
          margin-top: 6px;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary); line-height: 1.45;
        }
        .vc-counter {
          display: flex; justify-content: space-between; margin-top: 5px;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary);
        }
        .vc-counter b { color: var(--v-accent-light); font-weight: 600; }
        .vc-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        @media (max-width: 480px) { .vc-two-col { grid-template-columns: 1fr; } }

        .vc-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        @media (max-width: 480px) { .vc-tiles { grid-template-columns: repeat(2, 1fr); } }
        .vc-tile {
          padding: 11px 8px; border-radius: 10px; cursor: pointer; text-align: center;
          border: 1px solid rgba(37, 99, 235,0.1); background: var(--v-bg-elevated);
          color: var(--v-text-tertiary);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; font-weight: 500;
          transition: color .15s, background .15s, border-color .15s;
        }
        .vc-tile:hover:not(:disabled) { color: var(--v-text-primary); }
        .vc-tile.on { color: var(--v-accent); background: rgba(37, 99, 235,0.08); border-color: rgba(37, 99, 235,0.4); }
        .vc-tile:disabled { opacity: .35; cursor: not-allowed; }
        .vc-tile-sub {
          display: block; margin-top: 3px;
          font-size: 8px; font-weight: 600; letter-spacing: .14em; color: var(--v-text-tertiary);
        }
        .vc-toggle-inline {
          display: inline-flex; align-items: center; gap: 8px; margin-top: 10px;
          cursor: pointer;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11px; color: var(--v-text-tertiary);
        }
        .vc-toggle-inline input { accent-color: var(--v-accent); }

        .vc-search {
          display: flex; align-items: center; gap: 9px;
          background: var(--v-bg-elevated); border: 1px solid rgba(37, 99, 235,0.1);
          border-radius: 999px; padding: 9px 14px; margin-bottom: 10px;
        }
        .vc-search svg { width: 13px; height: 13px; color: var(--v-accent); flex-shrink: 0; }
        .vc-search input {
          flex: 1; min-width: 0; background: transparent; border: 0; outline: 0;
          color: var(--v-text-primary);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif; font-size: 13px;
        }
        .vc-search input::placeholder { color: var(--v-text-tertiary); }

        .vc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .vc-chip {
          padding: 8px 13px 7px; border-radius: 999px; cursor: pointer;
          border: 1px solid rgba(37, 99, 235,0.1); background: transparent;
          color: var(--v-text-tertiary);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; font-weight: 400; transition: color .15s, background .15s, border-color .15s;
        }
        .vc-chip:hover { color: var(--v-text-primary); }
        .vc-chip.on {
          color: var(--v-accent); background: rgba(37, 99, 235,0.08);
          border-color: rgba(37, 99, 235,0.3); font-weight: 500;
        }
        .vc-chip-empty {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11px; color: var(--v-text-tertiary); padding: 8px 0;
        }

        .vc-target {
          background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%);
          border: 1px solid rgba(37, 99, 235,0.1); border-radius: 10px; padding: 14px;
        }
        .vc-target-result {
          display: flex; justify-content: space-between; align-items: center; gap: 10px;
          width: 100%; text-align: left; cursor: pointer;
          background: transparent; border: none; border-radius: 8px; padding: 9px 11px;
          transition: background .15s ease;
        }
        .vc-target-result:hover { background: rgba(37, 99, 235,0.06); }

        .vc-cover {
          border: 1px solid rgba(37, 99, 235,0.1); background: var(--v-bg-elevated);
          border-radius: 10px; padding: 16px;
        }
        .vc-cover-drop {
          border: 1.5px dashed rgba(37, 99, 235,0.3); border-radius: 10px;
          padding: 20px; text-align: center; cursor: pointer;
        }

        .vc-sticky {
          position: sticky; bottom: 0; z-index: 30;
          margin: 6px -16px 0; padding: 14px 16px 18px;
          background: linear-gradient(180deg, rgba(8,8,8,0) 0%, rgba(8,8,8,0.95) 32%, var(--v-bg-base) 100%);
        }
        .vc-cta {
          width: 100%; padding: 15px 18px 14px;
          background: var(--v-accent); color: var(--v-bg-base);
          border: none; border-radius: 999px; cursor: pointer;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-weight: 600; font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        }
        .vc-cta svg { width: 13px; height: 13px; }
        .vc-cta:disabled { background: rgba(37, 99, 235,0.18); color: var(--v-text-tertiary); cursor: not-allowed; }
      `}</style>

      {saving && <MarketplaceLoader variant="fullscreen" ariaLabel="Enviando publicación" />}

      {editorSrc !== null && editorTarget?.kind === 'new' && (
        <PhotoEditorModal
          src={editorSrc}
          onSave={(dataUrl) => {
            const prevDisplayUrl = imagePreviews[editorTarget.idx]
            setEditedImages(prev => ({ ...prev, [editorTarget.idx]: dataUrl }))
            if (coverUrl === prevDisplayUrl) setCoverUrl(dataUrl)
            if (profilePhotoUrl === prevDisplayUrl) setProfilePhotoUrl(dataUrl)
            setEditorSrc(null); setEditorTarget(null)
          }}
          onClose={() => { setEditorSrc(null); setEditorTarget(null) }}
        />
      )}

      <div className="vc-page">

        {statusMsg && <div className={`vc-toast ${statusMsg.type}`}>{statusMsg.text}</div>}

        <div className="vc-stepper-wrap">
          <div className="vc-stepper">
            {VC_STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`vc-step ${activeSection === s.id ? 'active' : ''}`}
                onClick={() => scrollToSection(s.id)}
              >
                <span className="vc-step-n">{i + 1}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="vc-container">
          <div className="vc-head">
            <h1>{isAdminMode ? 'Crear publicación' : 'Publicar anuncio'}</h1>
            <p>{isAdminMode
              ? 'Creás la publicación en nombre de una anunciante verificada — se publica directo.'
              : 'Tu publicación queda en revisión hasta que un moderador la apruebe (24-48 h).'}</p>
          </div>

          <form onSubmit={handleCreate} className="vc-form">

            {isAdminMode && (
              <section className="vc-section">
                <div className="vc-sec-head"><h3>Anunciante representada</h3></div>
                <div className="vc-target">
                  {!targetProfile ? (
                    <>
                      <div className="vc-input-wrap" style={{ marginBottom: '10px' }}>
                        <input
                          className="vc-input" type="text" value={targetSearchQuery}
                          onChange={e => setTargetSearchQuery(e.target.value)}
                          placeholder="Buscar por email o nombre (mín. 2 caracteres)…"
                        />
                      </div>
                      {targetSearching && <p className="vc-hint" style={{ marginTop: 0 }}>Buscando…</p>}
                      {targetSearchResults.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '300px', overflowY: 'auto' }}>
                          {targetSearchResults.map(p => {
                            const sc = p.verification_status === 'approved' ? 'var(--v-success)'
                              : p.verification_status === 'rejected' ? 'var(--v-error)' : 'var(--v-accent)'
                            const sl = p.verification_status === 'approved' ? 'KYC aprobado'
                              : p.verification_status === 'pending' ? 'KYC pendiente'
                              : p.verification_status === 'rejected' ? 'KYC rechazado' : 'Sin verificar'
                            return (
                              <button
                                key={p.id} type="button" className="vc-target-result"
                                onClick={() => { setTargetUserId(p.id); setTargetProfile(p); setTargetSearchQuery(''); setTargetSearchResults([]) }}
                              >
                                <span style={{ minWidth: 0, flex: 1, fontFamily: "'Switzer','Inter',Arial,sans-serif", fontSize: '13px', color: 'var(--v-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {p.full_name || p.email}
                                </span>
                                <span style={{ fontFamily: "'Switzer','Inter',Arial,sans-serif", fontSize: '9px', letterSpacing: '.1em', color: sc, flexShrink: 0 }}>{sl}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                      {!targetSearching && targetSearchQuery.trim().length >= 2 && targetSearchResults.length === 0 && (
                        <p className="vc-hint" style={{ marginTop: '8px' }}>Sin resultados. Verificá que la anunciante haya creado cuenta en /registro.</p>
                      )}
                    </>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontFamily: "'Switzer','Inter',Arial,sans-serif", fontSize: '14px', color: 'var(--v-text-primary)' }}>
                          {targetProfile.full_name || targetProfile.email}
                        </div>
                        <div className="vc-hint" style={{ marginTop: '4px', color: targetProfile.verification_status === 'approved' ? 'var(--v-success)' : 'var(--v-error)' }}>
                          {targetProfile.verification_status === 'approved'
                            ? 'KYC aprobado — lista para asociar publicación'
                            : `KYC ${targetProfile.verification_status || 'sin estado'} — aprobá la verificación en /admin antes de crear`}
                        </div>
                      </div>
                      <button type="button" className="vc-chip" onClick={() => { setTargetUserId(null); setTargetProfile(null) }}>Cambiar</button>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section id="vc-sec-basico" data-vc-section="basico" className="vc-section">
              <div className="vc-sec-head"><h3>Datos del perfil</h3></div>
              <div className="vc-field">
                <label>Nombre artístico</label>
                <div className="vc-input-wrap">
                  <input className="vc-input" type="text" value={title} onChange={e => setTitle(e.target.value)} required />
                </div>
              </div>
              {isAdminMode && (
                <>
                  <div className="vc-field">
                    <label>Categoría</label>
                    <div className="vc-tiles">
                      {CATEGORIES.map(cat => {
                        const isActive = cat.id === 'hogar-reparaciones' || activeCategories.has(cat.id)
                        return (
                          <button
                            key={cat.id} type="button" disabled={!isActive}
                            className={`vc-tile ${category === cat.id ? 'on' : ''}`}
                            onClick={() => isActive && setCategory(cat.id)}
                          >
                            {cat.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="vc-field">
                    <label>Nivel de publicación</label>
                    <div className="vc-tiles">
                      {TIERS.filter(t => showInactiveTiers || activeTierSlugs.has(t.id)).map(t => {
                        const isInactive = !activeTierSlugs.has(t.id)
                        return (
                          <button
                            key={t.id} type="button"
                            className={`vc-tile ${tier === t.id ? 'on' : ''}`}
                            onClick={() => setTier(t.id)}
                          >
                            {t.label}
                            {isInactive && <span className="vc-tile-sub">Inactivo</span>}
                          </button>
                        )
                      })}
                    </div>
                    <label className="vc-toggle-inline">
                      <input type="checkbox" checked={showInactiveTiers} onChange={e => setShowInactiveTiers(e.target.checked)} />
                      Mostrar niveles inactivos
                    </label>
                  </div>
                </>
              )}
              <div className="vc-field" style={{ marginBottom: 0 }}>
                <label>País</label>
                <div className="vc-input-wrap">
                  <select className="vc-input" value={city} onChange={e => setCity(e.target.value)}>
                    <option value="buenosaires">Argentina</option>
                  </select>
                </div>
              </div>
            </section>

            <section id="vc-sec-contacto" data-vc-section="contacto" className="vc-section">
              <div className="vc-sec-head"><h3>Contacto</h3></div>
              <div className="vc-field">
                <label>WhatsApp</label>
                <div className="vc-input-wrap">
                  <span className="vc-icon-left">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 3.5A11 11 0 0 0 3 18.5L2 22l3.5-1A11 11 0 1 0 20.5 3.5z" /></svg>
                  </span>
                  <input
                    className="vc-input" type="tel" value={whatsapp} maxLength={15} placeholder="+5491126783554"
                    onChange={e => setWhatsapp(e.target.value.replace(/[^\d+]/g, ''))} required
                  />
                </div>
                <p className="vc-hint">Formato +CCPNNNNNNNNN · máximo 14 caracteres con el +</p>
              </div>
              <div className="vc-field" style={{ marginBottom: 0 }}>
                <label>Telegram <span className="opt">(opcional)</span></label>
                <div className="vc-input-wrap">
                  <span className="vc-icon-left">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 4 3 11l6 2.5L11 20l3.5-4 5 3.5L21 4z" /></svg>
                  </span>
                  <input
                    className="vc-input" type="tel" value={telegram} maxLength={15} placeholder="+5491126783554"
                    onChange={e => setTelegram(e.target.value.replace(/[^\d+]/g, ''))}
                  />
                </div>
                <p className="vc-hint">Si lo dejás vacío, el botón Telegram no aparece en la publicación.</p>
              </div>

              <div className="vc-sec-head" style={{ marginTop: '20px' }}>
                <h3>Precio</h3>
                <span className="vc-sec-count">USD principal · ARS/EUR opcionales</span>
              </div>
              <div className="vc-two-col">
                <div className="vc-field" style={{ marginBottom: 0 }}>
                  <label>USD</label>
                  <div className="vc-input-wrap">
                    <input className="vc-input" type="text" inputMode="numeric" value={priceUsd} placeholder="200"
                      onChange={e => setPriceUsd(formatThousands(e.target.value))} required />
                  </div>
                </div>
                <div className="vc-field" style={{ marginBottom: 0 }}>
                  <label>ARS <span className="opt">(opcional)</span></label>
                  <div className="vc-input-wrap">
                    <input className="vc-input" type="text" inputMode="numeric" value={price} placeholder="150.000"
                      onChange={e => setPrice(formatThousands(e.target.value))} />
                  </div>
                </div>
              </div>
              <div className="vc-field" style={{ marginTop: '10px', marginBottom: 0 }}>
                <label>EUR <span className="opt">(opcional)</span></label>
                <div className="vc-input-wrap">
                  <input className="vc-input" type="text" inputMode="numeric" value={priceEur} placeholder="180"
                    onChange={e => setPriceEur(formatThousands(e.target.value))} />
                </div>
              </div>
            </section>

            {(tier === 'gold' || tier === 'elite') && (
              <section className="vc-section">
                <div className="vc-sec-head">
                  <h3>Video de portada</h3>
                  <span className="vc-sec-count">Gold · Elite</span>
                </div>
                <div className="vc-cover">
                  {coverVideoPreview ? (
                    <div style={{ position: 'relative', maxWidth: '200px' }}>
                      <video src={coverVideoPreview} autoPlay loop muted playsInline
                        style={{ width: '100%', borderRadius: '8px', border: '1px solid rgba(37, 99, 235,0.3)' }} />
                      <button type="button" onClick={() => { setCoverVideo(null); setCoverVideoPreview(null) }}
                        style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(8,8,8,0.78)', border: 'none', color: '#e89898', width: 24, height: 24, borderRadius: '50%', cursor: 'pointer', fontSize: 12 }}>✕</button>
                    </div>
                  ) : (
                    <div className="vc-cover-drop" onClick={() => coverVideoRef.current?.click()}>
                      <p className="vc-hint" style={{ marginTop: 0, fontSize: '12px', color: 'var(--v-text-primary)' }}>Tocá para subir el video de portada</p>
                      <p className="vc-hint">MP4 vertical · máx. 50 MB · 30 seg recomendado</p>
                    </div>
                  )}
                  <input ref={coverVideoRef} type="file" accept="video/mp4,video/mov,video/quicktime" style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      if (file.size > 50 * 1024 * 1024) { showNotification('El video no puede superar 50MB', 'error'); return }
                      setCoverVideo(file)
                      setCoverVideoPreview(URL.createObjectURL(file))
                    }} />
                </div>
              </section>
            )}

            <section id="vc-sec-fotos" data-vc-section="fotos" className="vc-section">
              <MediaUploader
                isAdmin={true}
                tier={tier}
                tierLimits={tierLimits}
                getRootProps={getRootProps}
                getInputProps={getInputProps}
                isDragActive={isDragActive}
                newImageFiles={imageFiles}
                setNewImageFiles={setImageFiles}
                newImagePreviews={imagePreviews}
                setNewImagePreviews={setImagePreviews}
                editedNewImages={editedImages}
                setEditedNewImages={setEditedImages}
                newVideoFiles={videoFiles}
                setNewVideoFiles={setVideoFiles}
                newAudioFile={audioFile}
                setNewAudioFile={setAudioFile}
                coverUrl={coverUrl}
                setCoverUrl={setCoverUrl}
                profilePhotoUrl={profilePhotoUrl}
                setProfilePhotoUrl={setProfilePhotoUrl}
                setEditorSrc={setEditorSrc}
                setEditorTarget={setEditorTarget}
                uploadProgress={uploadProgress}
              />
            </section>

            <section id="vc-sec-descripcion" data-vc-section="descripcion" className="vc-section">
              <div className="vc-sec-head"><h3>Descripción</h3></div>
              <div style={{ position: 'relative' }}>
                <textarea
                  ref={descRef}
                  className="vc-textarea"
                  value={description}
                  placeholder="Describí tu propuesta…"
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
                        const textarea = descRef.current
                        if (!textarea) {
                          const newVal = description + emojiData.emoji
                          if (newVal.length <= 1500) setDescription(newVal)
                          setShowEmojiPicker(false)
                          return
                        }
                        const pos = textarea.selectionStart ?? description.length
                        const newVal = description.slice(0, pos) + emojiData.emoji + description.slice(pos)
                        if (newVal.length <= 1500) {
                          setDescription(newVal)
                          setTimeout(() => {
                            textarea.selectionStart = pos + emojiData.emoji.length
                            textarea.selectionEnd   = pos + emojiData.emoji.length
                            textarea.focus()
                          }, 0)
                        }
                        setShowEmojiPicker(false)
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="vc-counter">
                <span>Mín. 80 caracteres</span>
                <span><b>{description.length}</b> / 1500</span>
              </div>

            </section>

            <section id="vc-sec-atributos" data-vc-section="atributos" className="vc-section">
              <div className="vc-sec-head">
                <h3>Detalles del anuncio</h3>
                <span className="vc-sec-count">Completá los datos del servicio</span>
              </div>
              <ListingAttributeFields
                isAdmin={true}
                value={attributes}
                onChange={setAttribute}
              />
            </section>

            <section id="vc-sec-ubicacion" data-vc-section="ubicacion" className="vc-section">
              <GeoCascadePicker geo={geo} />
            </section>

            <div className="vc-sticky">
              <button
                type="submit"
                className="vc-cta"
                disabled={saving || (isAdminMode && (!targetProfile || targetProfile.verification_status !== 'approved'))}
                title={
                  isAdminMode && !targetProfile
                    ? 'Seleccioná una anunciante primero'
                    : isAdminMode && targetProfile && targetProfile.verification_status !== 'approved'
                      ? 'La anunciante no tiene KYC aprobado'
                      : undefined
                }
              >
                {saving
                  ? (isAdminMode ? 'Creando…' : 'Enviando…')
                  : (isAdminMode ? 'Crear publicación' : 'Enviar para revisión')}
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
