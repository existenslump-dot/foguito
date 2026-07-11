'use client'

/**
 * ContentCreateForm — the creator's content upload form.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ INVARIANTE: this form NEVER inserts `content` via the Supabase SDK. It      │
 * │ POSTs multipart/form-data to /api/content, which is server-authoritative:   │
 * │ it binds creator_id to the session, uploads the media to the PRIVATE        │
 * │ `creator-content` bucket, and lands a DRAFT. A client-side insert would let │
 * │ the creator set media_ref/status/visibility arbitrarily and skip the bucket.│
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * The media is validated client-side for fast feedback (same whitelist the
 * route re-checks server-side — defense in depth).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TIERS } from '@/lib/categories'
import {
  validateImageFile,
  validateVideoFile,
  IMAGE_ACCEPT_ATTR,
  VIDEO_ACCEPT_ATTR,
} from '@/lib/upload-validation'
import { MAX_STORY_VIDEO_SIZE } from '@/lib/media-limits'

const MONO = { fontFamily: 'var(--v-font-ui)' } as const

type Visibility = 'free_preview' | 'tier' | 'ppv'

export default function ContentCreateForm() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('tier')
  const [requiredTier, setRequiredTier] = useState<string>(TIERS[0]?.id ?? 'gold')
  const [ppvPrice, setPpvPrice] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setMsg(null)
    const f = e.target.files?.[0] ?? null
    if (!f) { setFile(null); return }
    // Validate by type: image OR video.
    const isVideo = f.type.startsWith('video/')
    const result = isVideo ? validateVideoFile(f, MAX_STORY_VIDEO_SIZE) : validateImageFile(f)
    if (!result.ok) {
      setMsg({ text: result.reason, type: 'error' })
      setFile(null)
      e.target.value = ''
      return
    }
    setFile(f)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)

    if (!file) {
      setMsg({ text: 'Elegí un archivo (imagen o video).', type: 'error' })
      return
    }
    if (visibility === 'ppv') {
      const n = Number(ppvPrice)
      if (!Number.isInteger(n) || n <= 0) {
        setMsg({ text: 'Ingresá un precio en foguitos (entero positivo) para PPV.', type: 'error' })
        return
      }
    }

    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('media', file)
      if (title.trim()) fd.set('title', title.trim())
      if (caption.trim()) fd.set('caption', caption.trim())
      fd.set('visibility', visibility)
      if (visibility === 'tier') fd.set('required_tier', requiredTier)
      if (visibility === 'ppv') fd.set('ppv_price_credits', ppvPrice.trim())

      const res = await fetch('/api/content', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg({ text: data?.error || `No se pudo subir el contenido (HTTP ${res.status})`, type: 'error' })
        setSaving(false)
        return
      }

      setMsg({ text: 'Contenido subido. Queda en revisión antes de publicarse.', type: 'success' })
      setTitle('')
      setCaption('')
      setPpvPrice('')
      setFile(null)
      // Reset the file input.
      const input = document.getElementById('content-media-input') as HTMLInputElement | null
      if (input) input.value = ''
      router.refresh()
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Error de red', type: 'error' })
    }
    setSaving(false)
  }

  const inputCls =
    'w-full bg-[var(--v-bg-base)] border border-white/5 px-3.5 py-3 rounded-[6px] outline-none text-[12px] font-normal text-[var(--v-text-primary)] box-border'

  return (
    <form onSubmit={onSubmit} className="bg-[var(--v-bg-card)] border border-white/5 rounded-[8px] p-6 flex flex-col gap-4">
      <h2 className="text-[clamp(18px,3vw,24px)] font-normal text-[var(--v-text-primary)]">Subir contenido</h2>

      <div>
        <label className="block text-[9px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] mb-1.5" style={MONO}>
          Título
        </label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputCls} style={MONO} placeholder="Opcional" />
      </div>

      <div>
        <label className="block text-[9px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] mb-1.5" style={MONO}>
          Descripción
        </label>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2000} rows={3} className={inputCls} style={MONO} placeholder="Opcional" />
      </div>

      <div>
        <label className="block text-[9px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] mb-1.5" style={MONO}>
          Archivo (imagen o video)
        </label>
        <input
          id="content-media-input"
          type="file"
          accept={`${IMAGE_ACCEPT_ATTR},${VIDEO_ACCEPT_ATTR}`}
          onChange={onPickFile}
          className="text-[12px] text-[var(--v-text-tertiary)]"
          style={MONO}
        />
        {file && (
          <p className="mt-1.5 text-[10px] text-[var(--v-text-tertiary)]" style={MONO}>
            {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
          </p>
        )}
      </div>

      <div>
        <label className="block text-[9px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] mb-1.5" style={MONO}>
          Visibilidad
        </label>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)} className={inputCls} style={MONO}>
          <option value="free_preview">Vista previa gratis</option>
          <option value="tier">Por suscripción (tier)</option>
          <option value="ppv">Pago por ver (PPV)</option>
        </select>
      </div>

      {visibility === 'tier' && (
        <div>
          <label className="block text-[9px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] mb-1.5" style={MONO}>
            Tier requerido
          </label>
          <select value={requiredTier} onChange={(e) => setRequiredTier(e.target.value)} className={inputCls} style={MONO}>
            {TIERS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
      )}

      {visibility === 'ppv' && (
        <div>
          <label className="block text-[9px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] mb-1.5" style={MONO}>
            Precio (foguitos)
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={ppvPrice}
            onChange={(e) => setPpvPrice(e.target.value)}
            className={inputCls}
            style={MONO}
            placeholder="Ej: 50"
          />
        </div>
      )}

      {msg && (
        <p
          className={`text-[11px] font-normal ${msg.type === 'success' ? 'text-[var(--v-success)]' : 'text-[var(--v-error)]'}`}
          style={MONO}
        >
          {msg.text}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="self-start px-6 py-3 bg-[var(--v-accent)] text-[var(--v-bg-base)] border-0 rounded-[6px] cursor-pointer text-[9px] font-normal tracking-[.18em] uppercase disabled:opacity-50"
        style={MONO}
      >
        {saving ? 'Subiendo…' : 'Subir contenido'}
      </button>

      <p className="text-[9px] text-[var(--v-text-tertiary)] tracking-[.1em] leading-relaxed" style={MONO}>
        El archivo se sube a un almacenamiento privado y queda en revisión. Nada se publica sin verificación 18+,
        registro 2257 completo y escaneo de seguridad.
      </p>
    </form>
  )
}
