'use client'
import { useState, useEffect } from 'react'
import { validateImageFile, validateVideoFile } from '@/lib/upload-validation'
import VerifyUploadStep, { type VerifyStepState } from '@/components/verify/VerifyUploadStep'

/**
 * Why a server endpoint (POST /api/admin/identity-upload) instead of a
 * direct SDK upload from this component: the `identity-documents` Supabase
 * Storage bucket has a per-user RLS policy ("auth.uid() must match first
 * folder segment"). An admin uploading to `{target_user_id}/...` is
 * auth.uid()=admin, fails the check. The API route uses service-role to
 * bypass RLS, keeping the user-facing policy intact.
 */

type Props = {
  /** Profile UUID to verify. NEVER the admin's own UUID — the caller
   *  guards this. */
  userId: string
  currentStatus?: string | null
  onSuccess?: () => void
}

export default function AdminVerifyForUser({ userId, currentStatus, onSuccess }: Props) {
  const [docFile,     setDocFile]     = useState<File | null>(null)
  const [docPreview,  setDocPreview]  = useState<string | null>(null)
  const [selfieFile,  setSelfieFile]  = useState<File | null>(null)
  const [selfiePrev,  setSelfiePrev]  = useState<string | null>(null)
  const [videoFile,   setVideoFile]   = useState<File | null>(null)
  const [videoPrev,   setVideoPrev]   = useState<string | null>(null)
  const [saving,      setSaving]      = useState(false)
  const [toast,       setToast]       = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [status,      setStatus]      = useState<string | null | undefined>(currentStatus)

  // Revoke blob previews on unmount — abandoned object URLs leak GPU memory
  // on long sessions.
  useEffect(() => {
    return () => {
      for (const url of [docPreview, selfiePrev, videoPrev]) {
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
      }
    }
  }, [docPreview, selfiePrev, videoPrev])

  const showToast = (text: string, type: 'success' | 'error') => {
    setToast({ text, type })
    setTimeout(() => setToast(null), 5000)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!docFile || (!selfieFile && !videoFile)) {
      showToast('Cargá el documento y al menos una prueba de vida: selfie o video', 'error')
      return
    }
    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('target_user_id', userId)
      fd.set('doc', docFile)
      if (selfieFile) fd.set('selfie', selfieFile)
      if (videoFile) fd.set('video', videoFile)

      const res = await fetch('/api/admin/identity-upload', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(json?.error || `Error ${res.status}`, 'error')
      } else {
        setStatus('approved')
        showToast('Verificación aprobada y docs subidos', 'success')
        setDocFile(null); setDocPreview(null)
        setSelfieFile(null); setSelfiePrev(null)
        setVideoFile(null); setVideoPrev(null)
        onSuccess?.()
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error de red', 'error')
    } finally {
      setSaving(false)
    }
  }

  const alreadyApproved = status === 'approved'

  const step1Done = !!docFile
  const step2Done = !!selfieFile
  const step3Done = !!videoFile
  const currentStep = !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : 0
  const stepStateFor = (i: 1 | 2 | 3): VerifyStepState => {
    const done = i === 1 ? step1Done : i === 2 ? step2Done : step3Done
    return done ? 'done' : i === currentStep ? 'current' : 'pending'
  }
  const filesDone = [step1Done, step2Done, step3Done].filter(Boolean).length

  return (
    <section className="avu-section">
      <style>{`
        .avu-section {
          margin-top: 24px; padding: 18px;
          background: linear-gradient(135deg, rgba(37, 99, 235,0.05) 0%, rgba(37, 99, 235,0.02) 100%);
          border: 1px solid rgba(37, 99, 235,0.22); border-radius: 12px;
        }
        .avu-head { display: flex; align-items: center; gap: 12px; }
        .avu-ic {
          width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
          background: rgba(37, 99, 235,0.08); border: 1px solid rgba(37, 99, 235,0.22);
          color: var(--v-accent); display: flex; align-items: center; justify-content: center;
        }
        .avu-ic svg { width: 16px; height: 16px; }
        .avu-ttl {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 17px; color: var(--v-text-primary); line-height: 1.1;
        }
        .avu-sub {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-accent);
          letter-spacing: .1em; text-transform: uppercase; margin-top: 3px; font-weight: 500;
        }
        .avu-desc {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 11.5px; color: var(--v-text-tertiary); line-height: 1.55; margin: 12px 0 14px;
        }
        .avu-desc b { color: var(--v-accent); font-weight: 500; }
        .avu-warn {
          margin-bottom: 14px; padding: 9px 12px;
          background: rgba(106,176,106,0.08); border: 1px solid rgba(106,176,106,0.3);
          border-radius: 8px;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10.5px; color: #9dd09d; line-height: 1.5;
        }
        .avu-progress {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10px; color: var(--v-text-tertiary);
          letter-spacing: .04em; margin: 4px 0 14px;
        }
        .avu-progress b { color: var(--v-accent-light); font-weight: 600; }
        .avu-cta {
          margin-top: 6px; width: 100%; padding: 14px;
          background: var(--v-accent); color: var(--v-bg-base);
          border: none; border-radius: 999px; cursor: pointer;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-weight: 600; font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
        }
        .avu-cta:disabled { background: rgba(37, 99, 235,0.18); color: var(--v-text-tertiary); cursor: not-allowed; }
        .avu-toast {
          margin-top: 12px; padding: 10px 14px; border-radius: 8px;
          font-family: 'Switzer','Inter',Arial,sans-serif; font-size: 11px;
        }
        .avu-toast.success { background: rgba(106,176,106,0.12); border: 1px solid rgba(106,176,106,0.4); color: #9dd09d; }
        .avu-toast.error { background: rgba(199,90,90,0.12); border: 1px solid rgba(199,90,90,0.4); color: #e89898; }
      `}</style>

      <div className="avu-head">
        <span className="avu-ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </span>
        <div>
          <div className="avu-ttl">Verificación de identidad</div>
          <div className="avu-sub">Admin · auto-aprobar</div>
        </div>
      </div>

      <p className="avu-desc">
        Subí el documento del usuario y al menos una prueba de vida —selfie o video—. Al confirmar, el perfil queda{' '}
        <b>aprobado automáticamente</b> y el badge ✓ aparece en todos sus posts.
      </p>

      {alreadyApproved && (
        <div className="avu-warn">
          ✓ Este perfil ya está verificado. Al volver a subir se sobrescriben los archivos previos.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <VerifyUploadStep
          n={1}
          title="Documento de identidad"
          subtitle="Pasaporte, cédula, DNI o documento oficial con foto"
          uploadTitle="Subí el documento"
          specs="JPG o PNG · documento oficial legible"
          state={stepStateFor(1)}
          kind="image"
          captureMode="environment"
          uploadAccept="image/jpeg,image/png,image/webp"
          primaryLabel="Tomar foto"
          secondaryLabel="Subir archivo"
          file={docFile}
          preview={docPreview}
          onPick={(f, p) => { setDocFile(f); setDocPreview(p) }}
          onClear={() => { setDocFile(null); setDocPreview(null) }}
          validate={validateImageFile}
          onError={msg => showToast(msg, 'error')}
        />

        <VerifyUploadStep
          n={2}
          title="Selfie con documento"
          subtitle="Foto del usuario sosteniendo el documento junto al rostro + fecha"
          uploadTitle="Subí la selfie"
          specs="JPG o PNG · rostro y documento nítidos"
          state={stepStateFor(2)}
          kind="image"
          captureMode="user"
          uploadAccept="image/jpeg,image/png,image/webp"
          primaryLabel="Tomar foto"
          secondaryLabel="Subir archivo"
          file={selfieFile}
          preview={selfiePrev}
          onPick={(f, p) => { setSelfieFile(f); setSelfiePrev(p) }}
          onClear={() => { setSelfieFile(null); setSelfiePrev(null) }}
          validate={validateImageFile}
          onError={msg => showToast(msg, 'error')}
        />

        <VerifyUploadStep
          n={3}
          title="Video de verificación"
          subtitle="Video corto (5-10 s) diciendo nombre y fecha de hoy"
          uploadTitle="Subí el video"
          specs="MP4 · 5 a 10 segundos"
          state={stepStateFor(3)}
          kind="video"
          captureMode="user"
          uploadAccept="video/mp4,video/webm,video/quicktime"
          primaryLabel="Grabar ahora"
          secondaryLabel="Subir"
          file={videoFile}
          preview={videoPrev}
          onPick={(f, p) => { setVideoFile(f); setVideoPrev(p) }}
          onClear={() => { setVideoFile(null); setVideoPrev(null) }}
          validate={validateVideoFile}
          onError={msg => showToast(msg, 'error')}
        />

        <p className="avu-progress">
          <b>{filesDone} de 3</b> archivos · mínimo: documento + selfie o video
        </p>

        <button
          type="submit"
          className="avu-cta"
          disabled={saving || !docFile || (!selfieFile && !videoFile)}
        >
          {saving ? 'Subiendo y aprobando…' : 'Subir y aprobar verificación'}
        </button>
      </form>

      {toast && <div className={`avu-toast ${toast.type}`}>{toast.text}</div>}
    </section>
  )
}
