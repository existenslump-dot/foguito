'use client'
import { supabase } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { validateImageFile, validateVideoFile } from '@/lib/upload-validation'
import MarketplaceLoader from '@/components/MarketplaceLoader'
import VerifyUploadStep, { type VerifyTip, type VerifyStepState } from '@/components/verify/VerifyUploadStep'
import { kycEnabled, getKycProvider, type KycStartResult } from '@/lib/kyc'

const DOC_TIPS: VerifyTip[] = [
  { ok: true,  text: 'Documento oficial vigente con foto' },
  { ok: true,  text: 'Datos nítidos, sin reflejos ni brillos' },
  { ok: false, text: 'No recortes las esquinas del documento' },
]
const SELFIE_TIPS: VerifyTip[] = [
  { ok: true,  text: 'Buena luz natural · rostro completo visible' },
  { ok: true,  text: 'Documento legible y bien visible' },
  { ok: false, text: 'Sin filtros · sin maquillaje pesado · sin lentes' },
]
const VIDEO_TIPS: VerifyTip[] = [
  { ok: true,  text: 'Decí tu nombre y la fecha de hoy' },
  { ok: true,  text: '5 a 10 segundos · buena luz, sin cortes' },
  { ok: false, text: 'Sin filtros ni edición' },
]

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export default function VerifyPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('unverified')
  const [note, setNote] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const [docFile, setDocFile] = useState<File | null>(null)
  const [docPreview, setDocPreview] = useState<string | null>(null)
  const [selfieFile, setSelfieFile] = useState<File | null>(null)
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoPreview, setVideoPreview] = useState<string | null>(null)

  const [genuineDocsAccepted, setGenuineDocsAccepted] = useState(false)

  const [startMode, setStartMode] = useState<KycStartResult['mode']>('internal')

  const [diditEnabled, setDiditEnabled] = useState(false)
  const [startingDidit, setStartingDidit] = useState(false)
  // Return from Didit's hosted flow, derived once from the URL. The webhook is
  // the source of truth; this only triggers the "processing" notice.
  const [returnedFromDidit] = useState(() => {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    return params.get('didit') === 'return' || params.has('verificationSessionId') || params.has('session_id')
  })

  const router = useRouter()

  useEffect(() => {
    // FEATURE_KYC gate: when verification is disabled for this deployment,
    // bounce the user back to the dashboard.
    if (!kycEnabled()) {
      router.replace('/dashboard')
      return
    }
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return router.push('/ingresar')
      setUserId(user.id)

      // Provider seam: ask the configured KYC provider how to start. The
      // built-in 'manual' provider returns { mode: 'internal' } (render the
      // in-app upload UI below); a hosted provider returns 'redirect'/'sdk'.
      try {
        const start = await getKycProvider().startVerification({ userId: user.id })
        setStartMode(start.mode)
      } catch (err) {
        console.error('[verify] provider startVerification failed', err)
        setStartMode('internal') // fail-open to the built-in flow
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('verification_status, verification_note')
        .eq('id', user.id)
        .single()

      if (profile) {
        setStatus(profile.verification_status || 'unverified')
        setNote(profile.verification_note || null)
      }
      setLoading(false)
    }
    load()
  }, [router])

  // Ask the backend whether the Didit provider is configured (drives the
  // automated-verification CTA).
  useEffect(() => {
    fetch('/api/verification/didit-session')
      .then(r => r.ok ? r.json() : { enabled: false })
      .then(d => setDiditEnabled(Boolean(d?.enabled)))
      .catch(() => setDiditEnabled(false))
  }, [])

  // Revoke blob previews on unmount — the doc/selfie/video previews are object
  // URLs that would otherwise leak when the user abandons the page.
  useEffect(() => {
    return () => {
      for (const url of [docPreview, selfiePreview, videoPreview]) {
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
      }
    }
  }, [docPreview, selfiePreview, videoPreview])

  const showToast = (text: string, type: 'success' | 'error') => {
    setToast({ text, type })
    setTimeout(() => setToast(null), 5000)
  }

  const startDidit = async () => {
    setStartingDidit(true)
    try {
      const res = await fetch('/api/verification/didit-session', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || 'No se pudo iniciar la verificación automática')
      }
      window.location.assign(data.url)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al iniciar la verificación', 'error')
      setStartingDidit(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!docFile || (!selfieFile && !videoFile)) {
      showToast('Subí tu documento y al menos una verificación con tu rostro: selfie o video', 'error')
      return
    }
    if (!genuineDocsAccepted) {
      showToast('Confirmá que la documentación es genuina y de tu propiedad antes de continuar', 'error')
      return
    }
    if (!userId) return

    setSaving(true)
    try {
      const docExt = docFile.name.split('.').pop() || 'jpg'
      const docPath = `${userId}/id_doc.${docExt}`
      const docUp = await supabase.storage.from('identity-documents').upload(docPath, docFile, { upsert: true })
      if (docUp.error) throw new Error(`No se pudo subir el documento: ${docUp.error.message}`)

      let selfiePath: string | null = null
      if (selfieFile) {
        const selfieExt = selfieFile.name.split('.').pop() || 'jpg'
        selfiePath = `${userId}/id_selfie.${selfieExt}`
        const selfieUp = await supabase.storage.from('identity-documents').upload(selfiePath, selfieFile, { upsert: true })
        if (selfieUp.error) throw new Error(`No se pudo subir la selfie: ${selfieUp.error.message}`)
      }

      let videoPath: string | null = null
      if (videoFile) {
        const videoExt = videoFile.name.split('.').pop() || 'mp4'
        videoPath = `${userId}/id_video.${videoExt}`
        const videoUp = await supabase.storage.from('identity-documents').upload(videoPath, videoFile, { upsert: true })
        if (videoUp.error) throw new Error(`No se pudo subir el video: ${videoUp.error.message}`)
      }

      const { error: profileErr } = await supabase.from('profiles').update({
        identity_doc_url: docPath,
        identity_selfie_url: selfiePath,
        identity_video_url: videoPath,
        verification_status: 'pending',
      }).eq('id', userId)
      if (profileErr) throw new Error(`No se pudo guardar la verificación: ${profileErr.message}`)

      const { error: postsErr } = await supabase.from('posts').update({
        verification_status: 'pending',
      }).eq('user_id', userId)
      if (postsErr) console.error('[verify] posts cascade failed', postsErr)

      try {
        const res = await fetch('/api/auth/finalize-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: 'verify',
            terms_accepted: true,
            privacy_accepted: true,
          }),
        })
        if (!res.ok) console.error('[verify] finalize-signup verify-context failed', { status: res.status })
      } catch (err) {
        console.error('[verify] finalize-signup verify-context network error', err)
      }

      setStatus('pending')
      showToast('Solicitud enviada. Revisaremos tu verificación en 24-48 horas.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al enviar verificación', 'error')
    }
    setSaving(false)
  }

  const step1Done = !!docFile
  const step2Done = !!selfieFile
  const step3Done = !!videoFile
  const currentStep = !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : 0
  const stepStateFor = (i: 1 | 2 | 3): VerifyStepState => {
    const done = i === 1 ? step1Done : i === 2 ? step2Done : step3Done
    return done ? 'done' : i === currentStep ? 'current' : 'pending'
  }
  const livenessDone = step2Done || step3Done
  const consentsDone = genuineDocsAccepted
  const canSubmit = step1Done && livenessDone && consentsDone && !saving

  const missing: string[] = []
  if (!step1Done) missing.push('documento')
  if (!livenessDone) missing.push('selfie o video')
  if (!consentsDone) missing.push('aceptar términos')
  const progressHint = saving
    ? 'Subiendo tus archivos de forma segura…'
    : missing.length === 0
      ? 'Todo listo · podés enviar tu verificación'
      : `Falta ${joinList(missing)}`

  if (loading) return (
    <div style={{
      minHeight: '100vh', background: 'var(--v-bg-base)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <MarketplaceLoader variant="block" />
    </div>
  )

  // Only the built-in 'internal' provider renders the in-app upload form.
  // A hosted provider (redirect/sdk) shows the hand-off placeholder instead.
  const showForm = (status === 'unverified' || status === 'rejected') && startMode === 'internal'
  const showHandoff = (status === 'unverified' || status === 'rejected') && startMode !== 'internal'

  return (
    <>
      <style>{`
        .vf-page { min-height: 100vh; background: var(--v-bg-base); color: var(--v-text-primary); }
        .vf-container { max-width: 520px; margin: 0 auto; padding-bottom: 8px; }

        .vf-hero { text-align: center; padding: 24px 22px 18px; }
        .vf-shield {
          width: 64px; height: 64px; margin: 0 auto 14px; border-radius: 50%;
          background: linear-gradient(135deg, rgba(37, 99, 235,0.18), rgba(37, 99, 235,0.04));
          border: 1px solid rgba(37, 99, 235,0.22); color: var(--v-accent);
          display: flex; align-items: center; justify-content: center;
        }
        .vf-shield svg { width: 28px; height: 28px; }
        .vf-hero h1 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 26px; color: var(--v-text-primary);
          line-height: 1.15; margin: 0 0 6px;
        }
        .vf-hero p {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 12.5px; color: var(--v-text-tertiary);
          line-height: 1.5; max-width: 320px; margin: 0 auto;
        }
        .vf-hero p b { color: var(--v-accent-light); font-weight: 500; }

        .vf-stepper {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 0 18px 20px; border-bottom: 1px solid rgba(37, 99, 235,0.08); margin-bottom: 20px;
        }
        .vf-step { display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 1; }
        .vf-step-num {
          width: 26px; height: 26px; border-radius: 50%;
          background: var(--v-bg-elevated); border: 1px solid rgba(37, 99, 235,0.08);
          color: var(--v-text-tertiary);
          display: flex; align-items: center; justify-content: center;
          font-family: 'Switzer','Inter',Arial,sans-serif; font-weight: 600; font-size: 11px;
        }
        .vf-step-num svg { width: 12px; height: 12px; }
        .vf-step-done .vf-step-num { background: var(--v-accent); border-color: var(--v-accent); color: var(--v-bg-base); }
        .vf-step-current .vf-step-num { background: rgba(37, 99, 235,0.08); border-color: var(--v-accent); color: var(--v-accent); }
        .vf-step-lbl {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase;
          font-weight: 500; color: var(--v-text-tertiary); text-align: center;
        }
        .vf-step-done .vf-step-lbl, .vf-step-current .vf-step-lbl { color: var(--v-accent-light); }
        .vf-step-bar { flex: 0 0 20px; height: 1px; background: rgba(37, 99, 235,0.08); margin-top: -16px; }
        .vf-step-bar.done { background: var(--v-accent); }

        .vf-form { padding: 0 18px; }

        .vf-sec {
          margin-top: 18px; padding: 14px 16px;
          background: linear-gradient(135deg, rgba(37, 99, 235,0.06) 0%, rgba(37, 99, 235,0.02) 100%);
          border: 1px solid rgba(37, 99, 235,0.22); border-radius: 10px;
        }
        .vf-sec-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .vf-sec-ic {
          width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
          background: rgba(37, 99, 235,0.08); border: 1px solid rgba(37, 99, 235,0.22);
          color: var(--v-accent); display: flex; align-items: center; justify-content: center;
        }
        .vf-sec-ic svg { width: 13px; height: 13px; }
        .vf-sec-ttl {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 13px; color: var(--v-accent);
          letter-spacing: .08em; text-transform: uppercase;
        }
        .vf-sec-rows {
          display: flex; flex-direction: column; gap: 8px;
          padding-bottom: 10px; border-bottom: 1px solid rgba(37, 99, 235,0.08); margin-bottom: 10px;
        }
        .vf-sec-r {
          display: flex; align-items: flex-start; gap: 8px;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 11.5px; color: var(--v-text-primary); line-height: 1.45;
        }
        .vf-sec-r svg { width: 11px; height: 11px; color: var(--v-accent); flex-shrink: 0; margin-top: 2px; }
        .vf-sec-r b { color: var(--v-accent-light); font-weight: 500; }
        .vf-sec-foot {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary); line-height: 1.5;
        }
        .vf-sec-foot b { color: var(--v-accent-light); font-weight: 500; }

        .vf-consents {
          margin-top: 18px; padding: 4px 14px;
          background: var(--v-bg-elevated);
          border: 1px solid rgba(37, 99, 235,0.08); border-radius: 10px;
        }
        .vf-consent-row {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 14px 0; cursor: pointer;
        }
        .vf-consent-row + .vf-consent-row { border-top: 1px solid rgba(37, 99, 235,0.08); }
        .vf-cbinput {
          appearance: none; -webkit-appearance: none;
          width: 19px; height: 19px; flex-shrink: 0; margin: 1px 0 0; cursor: pointer;
          border: 1.5px solid rgba(37, 99, 235,0.4); border-radius: 4px;
          background: var(--v-bg-base); position: relative;
        }
        .vf-cbinput:checked { background: var(--v-accent); border-color: var(--v-accent); }
        .vf-cbinput:checked::after {
          content: ''; position: absolute; left: 5px; top: 1.5px;
          width: 5px; height: 9px;
          border: solid var(--v-bg-base); border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }
        .vf-cbinput:focus-visible { outline: 2px solid var(--v-accent-light); outline-offset: 2px; }
        .vf-consent-txt {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 11.5px; color: var(--v-text-primary); line-height: 1.6;
        }
        .vf-consent-txt b { color: var(--v-accent-light); font-weight: 500; }

        .vf-sticky {
          position: sticky; bottom: 0; z-index: 10;
          padding: 14px 18px 18px;
          background: linear-gradient(180deg, rgba(8,8,8,0) 0%, rgba(8,8,8,0.95) 32%, var(--v-bg-base) 100%);
        }
        .vf-cta {
          width: 100%; padding: 15px 16px 14px;
          background: var(--v-accent); color: var(--v-bg-base);
          border: none; border-radius: 999px; cursor: pointer;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-weight: 600; font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        }
        .vf-cta svg { width: 13px; height: 13px; }
        .vf-cta:disabled { background: rgba(37, 99, 235,0.18); color: var(--v-text-tertiary); cursor: not-allowed; }
        .vf-cta-hint {
          text-align: center; margin-top: 10px;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary); letter-spacing: .03em;
        }
        .vf-cta-hint b { color: var(--v-accent-light); font-weight: 600; }

        .vf-statuscard {
          margin: 22px 18px 0; padding: 32px 24px; border-radius: 12px; text-align: center;
        }
        .vf-statuscard.warn { border: 1px solid rgba(37, 99, 235,0.25); background: rgba(37, 99, 235,0.04); }
        .vf-statuscard.ok { border: 1px solid rgba(106,176,106,0.32); background: rgba(106,176,106,0.04); }
        .vf-statuscard-ic {
          width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
        }
        .vf-statuscard.warn .vf-statuscard-ic { background: rgba(37, 99, 235,0.1); border: 1px solid rgba(37, 99, 235,0.25); color: var(--v-accent); }
        .vf-statuscard.ok .vf-statuscard-ic { background: rgba(106,176,106,0.1); border: 1px solid rgba(106,176,106,0.32); color: var(--v-success); }
        .vf-statuscard-ic svg { width: 24px; height: 24px; }
        .vf-statuscard h2 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 21px; margin: 0 0 8px; line-height: 1.2;
        }
        .vf-statuscard.warn h2 { color: var(--v-accent); }
        .vf-statuscard.ok h2 { color: var(--v-success); }
        .vf-statuscard p {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 12px; color: var(--v-text-tertiary); line-height: 1.6; margin: 0;
        }

        .vf-rejected {
          margin: 18px 18px 0; padding: 14px 16px;
          border: 1px solid rgba(199,90,90,0.3); background: rgba(199,90,90,0.05);
          border-radius: 10px;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 11.5px; color: var(--v-error); line-height: 1.5;
        }
        .vf-rejected b { font-weight: 600; letter-spacing: .04em; text-transform: uppercase; font-size: 10px; }

        .vf-toast {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 100;
          padding: 13px 28px; border-radius: 999px;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 11px; font-weight: 500; letter-spacing: .02em;
          max-width: calc(100vw - 32px); text-align: center;
        }
        .vf-toast.error { border: 1px solid rgba(199,90,90,0.3); background: rgba(40,12,12,0.95); color: #e89898; }
        .vf-toast.success { border: 1px solid rgba(37, 99, 235,0.3); background: rgba(20,16,8,0.95); color: var(--v-accent); }

        .vf-didit {
          margin: 18px 18px 0; padding: 18px 18px 16px;
          background: var(--v-bg-elevated);
          border: 1px solid var(--v-accent); border-radius: 12px;
        }
        .vf-didit-badge {
          display: inline-block; margin-bottom: 8px; padding: 3px 9px; border-radius: 999px;
          border: 1px solid var(--v-accent);
          font-family: 'Switzer','Inter',Arial,sans-serif; font-size: 9px; font-weight: 600;
          letter-spacing: .12em; text-transform: uppercase; color: var(--v-accent-light);
        }
        .vf-didit h2 {
          font-weight: 600; font-size: 18px; color: var(--v-text-primary); margin: 0 0 6px; line-height: 1.2;
        }
        .vf-didit p {
          font-family: 'Switzer','Inter',Arial,sans-serif; font-size: 11.5px; color: var(--v-text-tertiary);
          line-height: 1.5; margin: 0 0 14px;
        }
        .vf-didit-cta {
          width: 100%; padding: 14px 16px;
          background: var(--v-accent); color: #fff;
          border: none; border-radius: 999px; cursor: pointer;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-weight: 600; font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        }
        .vf-didit-cta:disabled { opacity: .6; cursor: not-allowed; }
        .vf-didit-cta svg { width: 13px; height: 13px; }
        .vf-divider {
          display: flex; align-items: center; gap: 12px; margin: 22px 18px 4px;
          font-family: 'Switzer','Inter',Arial,sans-serif; font-size: 10px; letter-spacing: .12em;
          text-transform: uppercase; color: var(--v-text-tertiary);
        }
        .vf-divider::before, .vf-divider::after {
          content: ''; flex: 1; height: 1px; background: var(--v-bg-elevated);
        }
        .vf-processing {
          margin: 18px 18px 0; padding: 14px 16px;
          border: 1px solid var(--v-accent); background: var(--v-bg-elevated);
          border-radius: 10px;
          font-family: 'Switzer','Inter',Arial,sans-serif; font-size: 11.5px; color: var(--v-accent-light); line-height: 1.5;
        }
        .vf-processing b { font-weight: 600; letter-spacing: .04em; text-transform: uppercase; font-size: 10px; color: var(--v-accent); }
      `}</style>

      <div className="vf-page">
        {toast && <div className={`vf-toast ${toast.type}`}>{toast.text}</div>}

        <div className="vf-container">
          {returnedFromDidit && status !== 'approved' && (
            <div className="vf-processing">
              <b>Verificación recibida</b><br />
              Recibimos tu verificación. Puede tardar unos minutos en procesarse — vas a ver el resultado acá y te avisamos por email. Podés cerrar esta página.
            </div>
          )}

          {status === 'pending' && (
            <div className="vf-statuscard warn">
              <div className="vf-statuscard-ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
                </svg>
              </div>
              <h2>Verificación en revisión</h2>
              <p>Tu verificación está siendo revisada. Te notificaremos por email en 24-48 horas.</p>
            </div>
          )}

          {status === 'approved' && (
            <div className="vf-statuscard ok">
              <div className="vf-statuscard-ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z" /><path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <h2>Tu identidad está verificada</h2>
              <p>El badge ID VERIFICADA aparece en todos tus anuncios.</p>
            </div>
          )}

          {showForm && (
            <>
              {status === 'rejected' && note && (
                <div className="vf-rejected">
                  <b>Verificación rechazada</b><br />
                  {note}
                </div>
              )}

              {diditEnabled && (
                <>
                  <div className="vf-didit">
                    <span className="vf-didit-badge">Recomendado · al instante</span>
                    <h2>Verificá tu identidad en 2 minutos</h2>
                    <p>Verificación biométrica con prueba de vida. Subís tu documento y una selfie desde tu celular — sin esperar revisión manual.</p>
                    <button type="button" className="vf-didit-cta" onClick={startDidit} disabled={startingDidit}>
                      {startingDidit ? 'Abriendo…' : 'Verificar ahora'}
                      {!startingDidit && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14M13 5l7 7-7 7" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <div className="vf-divider">o cargá los archivos manualmente</div>
                </>
              )}

              <div className="vf-hero">
                <div className="vf-shield">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                </div>
                <h1>Verificá tu identidad</h1>
                <p>Subí tu <b>documento</b> y una prueba de vida —<b>selfie o video</b>— para obtener tu <b>badge verificada</b> y aparecer en los filtros basic.</p>
              </div>

              <div className="vf-stepper">
                <div className={`vf-step vf-step-${stepStateFor(1)}`}>
                  <span className="vf-step-num">{step1Done ? <Check /> : 1}</span>
                  <span className="vf-step-lbl">Documento</span>
                </div>
                <span className={`vf-step-bar ${step1Done ? 'done' : ''}`} />
                <div className={`vf-step vf-step-${stepStateFor(2)}`}>
                  <span className="vf-step-num">{step2Done ? <Check /> : 2}</span>
                  <span className="vf-step-lbl">Selfie</span>
                </div>
                <span className={`vf-step-bar ${step2Done ? 'done' : ''}`} />
                <div className={`vf-step vf-step-${stepStateFor(3)}`}>
                  <span className="vf-step-num">{step3Done ? <Check /> : 3}</span>
                  <span className="vf-step-lbl">Video</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="vf-form">
                <VerifyUploadStep
                  n={1}
                  title="Documento de identidad"
                  subtitle="DNI, pasaporte o cédula con foto"
                  uploadTitle="Subí tu documento"
                  specs="JPG o PNG · documento oficial legible"
                  state={stepStateFor(1)}
                  kind="image"
                  captureMode="environment"
                  uploadAccept="image/jpeg,image/png,image/webp"
                  primaryLabel="Tomar foto"
                  secondaryLabel="Subir archivo"
                  file={docFile}
                  preview={docPreview}
                  tips={DOC_TIPS}
                  onPick={(f, p) => { setDocFile(f); setDocPreview(p) }}
                  onClear={() => { setDocFile(null); setDocPreview(null) }}
                  validate={validateImageFile}
                  onError={msg => showToast(msg, 'error')}
                />

                <VerifyUploadStep
                  n={2}
                  title="Selfie con documento"
                  subtitle="Sosteniendo el documento junto a tu rostro · con esto o el video alcanza"
                  uploadTitle="Subí tu selfie"
                  specs="JPG o PNG · rostro y documento nítidos"
                  state={stepStateFor(2)}
                  kind="image"
                  captureMode="user"
                  uploadAccept="image/jpeg,image/png,image/webp"
                  primaryLabel="Tomar foto"
                  secondaryLabel="Subir archivo"
                  file={selfieFile}
                  preview={selfiePreview}
                  tips={SELFIE_TIPS}
                  onPick={(f, p) => { setSelfieFile(f); setSelfiePreview(p) }}
                  onClear={() => { setSelfieFile(null); setSelfiePreview(null) }}
                  validate={validateImageFile}
                  onError={msg => showToast(msg, 'error')}
                />

                <VerifyUploadStep
                  n={3}
                  title="Video de verificación"
                  subtitle="5–10 seg diciendo tu nombre y la fecha · con esto o la selfie alcanza"
                  uploadTitle="Grabá tu video"
                  specs="MP4 · 5 a 10 segundos"
                  state={stepStateFor(3)}
                  kind="video"
                  captureMode="user"
                  uploadAccept="video/mp4,video/webm,video/quicktime"
                  primaryLabel="Grabar ahora"
                  secondaryLabel="Subir"
                  file={videoFile}
                  preview={videoPreview}
                  tips={VIDEO_TIPS}
                  onPick={(f, p) => { setVideoFile(f); setVideoPreview(p) }}
                  onClear={() => { setVideoFile(null); setVideoPreview(null) }}
                  validate={validateVideoFile}
                  onError={msg => showToast(msg, 'error')}
                />

                <div className="vf-sec">
                  <div className="vf-sec-head">
                    <span className="vf-sec-ic">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="11" width="14" height="10" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                    </span>
                    <span className="vf-sec-ttl">Tus archivos están seguros</span>
                  </div>
                  <div className="vf-sec-rows">
                    <div className="vf-sec-r"><Check /><span>Cifrado <b>AES-256</b> en reposo · <b>TLS 1.2+</b> en tránsito</span></div>
                    <div className="vf-sec-r"><Check /><span>Bucket privado · URLs firmadas de corta expiración</span></div>
                    <div className="vf-sec-r"><Check /><span>Nunca visibles públicamente · solo el equipo de MARKETPLACE</span></div>
                  </div>
                  <div className="vf-sec-foot">
                    <>Retención conforme a la normativa de protección de datos aplicable: hasta 1 año tras el cierre de cuenta.</>
                  </div>
                </div>

                <div className="vf-consents">
                  <label className="vf-consent-row">
                    <input
                      type="checkbox"
                      className="vf-cbinput"
                      checked={genuineDocsAccepted}
                      onChange={e => setGenuineDocsAccepted(e.target.checked)}
                    />
                    <span className="vf-consent-txt">
                      Declaro que la <b>documentación</b> que estoy subiendo es <b>genuina y de mi propiedad</b>.
                    </span>
                  </label>
                </div>

                <div className="vf-sticky">
                  <button type="submit" className="vf-cta" disabled={!canSubmit}>
                    {saving ? 'Subiendo archivos…' : 'Enviar verificación'}
                    {!saving && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M13 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                  <div className="vf-cta-hint">{progressHint}</div>
                </div>
              </form>
            </>
          )}

          {/* Hosted-provider hand-off placeholder. The built-in 'manual'
              provider returns mode 'internal', so this never renders today —
              it's the seam where a redirect/SDK provider hands off. */}
          {showHandoff && (
            <div className="vf-statuscard warn">
              <div className="vf-statuscard-ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z" /><path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <h2>Verificación con proveedor externo</h2>
              <p>Tu verificación continúa con nuestro proveedor de identidad. Seguí las instrucciones que verás a continuación.</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
