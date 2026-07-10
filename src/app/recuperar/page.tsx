'use client'
import { resetPasswordForEmail } from '@/lib/supabase/direct'
import { useState, useRef, useEffect, Suspense } from 'react'
import Link from 'next/link'
import MarketplaceWordmark from '@/components/MarketplaceWordmark'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { Turnstile, TurnstileInstance } from '@marsidev/react-turnstile'
import SiteFooter from '@/components/SiteFooter'

function RecoverForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ text: string, type: 'success' | 'error' } | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const captchaRef = useRef<HCaptcha>(null)
  const turnstileRef = useRef<TurnstileInstance>(null)
  const cancelledRef = useRef(false)
  useEffect(() => () => { cancelledRef.current = true }, [])

  const hardResetCaptcha = () => {
    setCaptchaToken(null)
    setCaptchaKey(k => k + 1)
  }

  const showNotification = (text: string, type: 'success' | 'error') => {
    setStatusMsg({ text, type })
    setTimeout(() => setStatusMsg(null), 5000)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (!normalized) {
      showNotification('Ingresá tu correo electrónico', 'error')
      return
    }
    if (!captchaToken) {
      showNotification('Completá el captcha', 'error')
      return
    }
    setLoading(true)

    try {
      const gateRes = await fetch('/api/auth/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recover', email: normalized }),
      })
      if (cancelledRef.current) return
      if (gateRes.status === 429) {
        const data = await gateRes.json().catch(() => ({ error: 'Demasiados intentos. Probá más tarde.' }))
        showNotification(data.error || 'Demasiados intentos. Probá más tarde.', 'error')
        setLoading(false)
        return
      }
    } catch (err) {
      console.error('[auth-recover] gate call failed, proceeding anyway', err)
    }

    const { error } = await resetPasswordForEmail({
      email: normalized,
      redirectTo: `${window.location.origin}/auth/callback?redirect=/auth/actualizar-password`,
      captchaToken,
    })

    if (cancelledRef.current) return
    captchaRef.current?.resetCaptcha()
    turnstileRef.current?.reset()
    setCaptchaToken(null)

    if (error) {
      const raw = error.message || ''
      const msg = raw.toLowerCase()
      console.error('[auth-recover] reset failed', error)
      if (msg.includes('captcha')) {
        hardResetCaptcha()
        showNotification('Captcha expirado. Volvé a intentar.', 'error')
      } else if (msg.includes('rate') || msg.includes('too many')) {
        showNotification('Demasiados intentos. Esperá unos minutos.', 'error')
      } else {
        showNotification('No pudimos enviar el email. Intentá de nuevo.', 'error')
      }
      setLoading(false)
      return
    }

    setSubmitted(true)
    setLoading(false)
  }

  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        .v-fadein{opacity:0;animation:fadeUp .9s cubic-bezier(.22,1,.36,1) forwards}
        .d1{animation-delay:.1s}.d2{animation-delay:.25s}.d3{animation-delay:.4s}
        .d4{animation-delay:.55s}.d5{animation-delay:.7s}

        .v-input{
          width:100%;background:var(--v-bg-base);border:1px solid rgba(37, 99, 235,0.15);
          padding:14px 16px;border-radius:2px;outline:none;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:400;
          color:var(--v-text-primary);transition:border-color .4s ease;
        }
        .v-input::placeholder{color:var(--v-text-tertiary)}
        .v-input:focus{border-color:rgba(37, 99, 235,0.4)}

        .v-label{
          display:block;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:9px;font-weight:400;
          letter-spacing:.22em;text-transform:uppercase;color:var(--v-accent-strong);
          margin-bottom:8px;
        }

        .v-btn-primary{
          width:100%;background:var(--v-accent);color:#FFFFFF;padding:16px;
          border-radius:2px;border:none;cursor:pointer;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:500;
          letter-spacing:.18em;text-transform:uppercase;
          transition:background .4s ease;
        }
        .v-btn-primary:hover{background:var(--v-accent-light)}
        .v-btn-primary:disabled{background:rgba(37, 99, 235,0.1);color:var(--v-text-tertiary);cursor:not-allowed}

        .v-btn-ghost{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:9px;font-weight:400;
          letter-spacing:.2em;text-transform:uppercase;color:var(--v-text-secondary);
          border:1px solid rgba(37, 99, 235,0.15);padding:12px 28px;
          border-radius:2px;transition:color .4s ease,border-color .4s ease;
          text-decoration:none;display:inline-block;
        }
        .v-btn-ghost:hover{color:var(--v-accent-strong);border-color:rgba(37, 99, 235,0.3)}

        @keyframes lineExpand{from{transform:scaleX(0)}to{transform:scaleX(1)}}
        .v-line{
          display:block;height:1px;
          background:linear-gradient(90deg,transparent,var(--v-accent) 40%,var(--v-accent-light) 60%,transparent);
          transform-origin:left;animation:lineExpand 1.2s cubic-bezier(.22,1,.36,1) .3s forwards;
          transform:scaleX(0);
        }
      `}</style>

      <div className="min-h-screen flex flex-col bg-[var(--v-bg-base)] relative">

        {statusMsg && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-6 pointer-events-none">
            <div
              className={`rounded-[2px] px-8 py-3.5 border font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal tracking-[.2em] uppercase shadow-[0_8px_32px_rgba(0,0,0,0.45)] ${
                statusMsg.type === 'error'
                  ? 'border-[rgba(224,85,85,0.25)] bg-[rgba(40,12,12,0.95)] text-[var(--v-error)]'
                  : 'border-[rgba(37,99,235,0.25)] bg-[rgba(20,16,8,0.95)] text-[var(--v-accent)]'
              }`}
            >
              {statusMsg.text}
            </div>
          </div>
        )}

        <div className="flex-1 flex items-center justify-center w-full p-6">
          <div className="v-fadein d2 w-full max-w-[440px] p-12 bg-[var(--v-bg-card)] rounded-[2px] border border-[rgba(37,99,235,0.1)]">
            <div className="v-fadein d2 flex flex-col items-center mb-10">
              <MarketplaceWordmark size={30} className="mb-5" />
              <span className="v-line w-full mb-5" />
              <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] tracking-[.26em] uppercase text-[var(--v-accent-strong)] opacity-55 font-normal">
                Recuperar Contraseña
              </p>
            </div>

            {submitted ? (
              <div className="flex flex-col items-center gap-5 text-center">
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-normal leading-[1.6] text-[var(--v-text-primary)]">
                  Si tu correo está registrado en Marketplace, te enviamos un email con un enlace para restablecer tu contraseña.
                </p>
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-normal leading-[1.6] text-[var(--v-text-tertiary)]">
                  Revisá tu bandeja de entrada (y la carpeta de spam). El link expira en 1 hora.
                </p>
                <Link href="/ingresar" className="v-btn-ghost mt-4">Volver al inicio de sesión</Link>
              </div>
            ) : (
              <>
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal leading-[1.6] text-[var(--v-text-secondary)] mb-6 text-center">
                  Ingresá el correo asociado a tu cuenta. Te enviaremos un enlace para crear una contraseña nueva.
                </p>
                <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                  <div className="v-fadein d3">
                    <label className="v-label" htmlFor="recover-email">Correo Electrónico</label>
                    <input
                      id="recover-email"
                      type="email"
                      placeholder="tu@email.com"
                      className="v-input"
                      autoComplete="email"
                      inputMode="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="v-fadein d4 pt-2 flex flex-col gap-3 items-center">
                    {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? (
                      <Turnstile
                        key={captchaKey}
                        ref={turnstileRef}
                        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                        onSuccess={(token) => setCaptchaToken(token)}
                        onExpire={() => { setCaptchaToken(null); turnstileRef.current?.reset() }}
                        onError={() => hardResetCaptcha()}
                        options={{ theme: 'dark', size: 'flexible', refreshExpired: 'auto' }}
                      />
                    ) : process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY ? (
                      <HCaptcha
                        key={captchaKey}
                        ref={captchaRef}
                        sitekey={process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY}
                        onVerify={(token) => setCaptchaToken(token)}
                        onExpire={() => setCaptchaToken(null)}
                        theme="dark"
                      />
                    ) : null}
                    <button type="submit" className="v-btn-primary" disabled={loading || !captchaToken}>
                      {loading ? 'Enviando...' : 'Enviar enlace'}
                    </button>
                  </div>
                </form>

                <div className="mt-8 pt-6 border-t border-[rgba(37,99,235,0.08)] flex flex-col items-center gap-3">
                  <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal tracking-[.2em] uppercase text-[var(--v-text-tertiary)]">
                    ¿Te acordaste?
                  </p>
                  <Link href="/ingresar" className="v-btn-ghost">Volver al inicio de sesión</Link>
                </div>
              </>
            )}
          </div>
        </div>

        <SiteFooter />
      </div>
    </>
  )
}

export default function RecoverPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--v-bg-base)]" />}>
      <RecoverForm />
    </Suspense>
  )
}
