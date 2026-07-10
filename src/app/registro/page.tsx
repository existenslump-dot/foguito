'use client'
import { signUp, signInWithOAuth, supabaseFetch } from '@/lib/supabase/direct'
import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { Turnstile, TurnstileInstance } from '@marsidev/react-turnstile'
import { safeRedirectPath } from '@/lib/safe-redirect'
import CountryCodePicker from '@/components/CountryCodePicker'
import SecurityAccordion from '@/components/SecurityAccordion'
import { DEFAULT_COUNTRY, type CountryCode } from '@/lib/country-codes'

const EMAIL_VALID_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function RegisterForm() {
  // Explicit post-auth destination, propagated through OAuth so a user
  // who came from a deep-link (/registro?redirect=/publicar) still lands
  // on their intended page after Google login. Validated via the same
  // whitelist as /ingresar.
  const searchParams = useSearchParams()
  const rawRedirect = searchParams.get('redirect')
  const explicitRedirect = rawRedirect ? safeRedirectPath(rawRedirect, '') : ''

  const [displayName, setDisplayName]       = useState('')
  const [email, setEmail]                   = useState('')
  const [password, setPassword]             = useState('')
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(DEFAULT_COUNTRY)
  const [phoneNumber, setPhoneNumber]       = useState('')
  const [loading, setLoading]               = useState(false)
  const [phoneError, setPhoneError]         = useState<string | null>(null)
  const [statusMsg, setStatusMsg]           = useState<{ text: string, type: 'success' | 'error' } | null>(null)
  const [showPassword, setShowPassword]     = useState(false)
  const [captchaToken, setCaptchaToken]     = useState<string | null>(null)
  const [captchaKey, setCaptchaKey]         = useState(0)
  const [captchaFails, setCaptchaFails]     = useState(0)
  const [termsAccepted, setTermsAccepted]   = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [pwdError, setPwdError]             = useState<string | null>(null)
  const [successMsg, setSuccessMsg]         = useState<string | null>(null)
  const captchaRef = useRef<HCaptcha>(null)
  const turnstileRef = useRef<TurnstileInstance>(null)
  const cancelledRef = useRef(false)
  useEffect(() => () => { cancelledRef.current = true }, [])

  const [useAcceptAll, setUseAcceptAll] = useState(false)
  const handleAcceptAll = (checked: boolean) => {
    setUseAcceptAll(checked)
    setTermsAccepted(checked)
    setPrivacyAccepted(checked)
  }

  const hardResetCaptcha = () => {
    setCaptchaToken(null)
    setCaptchaKey(k => k + 1)
  }
  const router = useRouter()

  const showNotification = (text: string, type: 'success' | 'error', duration = 4000) => {
    setStatusMsg({ text, type })
    setTimeout(() => setStatusMsg(null), duration)
  }

  const passwordStrength = (pwd: string): number => {
    if (!pwd) return 0
    let score = 0
    if (pwd.length >= 8) score++
    if (/[A-Z]/.test(pwd)) score++
    if (/[a-z]/.test(pwd)) score++
    if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?¡¿~`·]/.test(pwd)) score++
    return Math.max(score, pwd.length > 0 ? 1 : 0)
  }
  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 8) return 'La contraseña debe tener al menos 8 caracteres'
    if (!/[A-Z]/.test(pwd)) return 'Debe incluir al menos una letra mayúscula'
    if (!/[a-z]/.test(pwd)) return 'Debe incluir al menos una letra minúscula'
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?¡¿~`·]/.test(pwd)) return 'Debe incluir al menos un caracter especial (!@#$...)'
    return null
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwdError(null); setSuccessMsg(null); setPhoneError(null)

    if (!termsAccepted) {
      showNotification('Debes aceptar los Términos y Condiciones', 'error')
      return
    }
    if (!privacyAccepted) {
      showNotification('Debes aceptar la Política de Privacidad', 'error')
      return
    }
    if (!captchaToken) {
      showNotification('Completa el captcha', 'error')
      return
    }
    const pwdRuleError = validatePassword(password)
    if (pwdRuleError) { setPwdError(pwdRuleError); return }

    const maxDigits = selectedCountry.maxDigits ?? 10
    if (phoneNumber.trim().length < maxDigits) {
      setPhoneError(`El número debe tener ${maxDigits} dígitos para ${selectedCountry.name}`)
      return
    }
    const finalPhone = selectedCountry.dial + phoneNumber.trim()
    const normalizedEmail = email.trim().toLowerCase()

    setLoading(true)

    try {
      const gateRes = await fetch('/api/auth/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register', email: normalizedEmail }),
      })
      if (cancelledRef.current) return
      if (gateRes.status === 429) {
        const data = await gateRes.json().catch(() => ({ error: 'Demasiados intentos. Probá más tarde.' }))
        showNotification(data.error || 'Demasiados intentos. Probá más tarde.', 'error')
        setLoading(false)
        return
      }
    } catch (err) {
      console.error('[auth-register] gate call failed, proceeding anyway', err)
    }

    try {
      const checkRes = await fetch('/api/auth/check-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, phone: finalPhone }),
      })
      if (cancelledRef.current) return
      if (checkRes.status === 429) {
        const data = await checkRes.json().catch(() => ({ error: 'Demasiadas consultas. Probá más tarde.' }))
        showNotification(data.error || 'Demasiadas consultas. Probá más tarde.', 'error')
        setLoading(false)
        return
      }
      if (checkRes.ok) {
        const body = await checkRes.json().catch(() => null) as { available?: boolean } | null
        if (body && body.available === false) {
          showNotification('Ese email o teléfono ya está registrado. Iniciá sesión.', 'error')
          setLoading(false)
          return
        }
      }
    } catch (err) {
      console.error('[auth-register] availability check failed, proceeding', err)
    }

    const { data: { session }, error } = await signUp({
      email: normalizedEmail, password,
      captchaToken: captchaToken ?? undefined,
      data: { phone: finalPhone },
    })

    if (cancelledRef.current) return

    if (error) {
      const raw = error.message || ''
      const msg = raw.toLowerCase()
      const isCaptcha = msg.includes('captcha') || msg.includes('invalid-input-response')
      if (isCaptcha) {
        hardResetCaptcha()
        setCaptchaFails(n => n + 1)
        const nextFails = captchaFails + 1
        showNotification(
          nextFails >= 2
            ? 'El captcha sigue fallando. Usá "Continuar con Google" abajo — es más rápido.'
            : 'Captcha expirado. Se está recargando — esperá unos segundos y volvé a intentar.',
          'error',
        )
      } else {
        captchaRef.current?.resetCaptcha()
        turnstileRef.current?.reset()
        setCaptchaToken(null)
        console.error('[auth-register] signUp failed', error)
        if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
          showNotification('Ese correo ya está registrado. Iniciá sesión en su lugar.', 'error')
        } else if (msg.includes('password') || msg.includes('weak')) {
          showNotification('La contraseña no cumple los requisitos mínimos.', 'error')
        } else if (msg.includes('email') && msg.includes('rate')) {
          showNotification(
            'No podemos enviar correos en este momento. Probá con Google arriba (es instantáneo) o esperá unos minutos.',
            'error',
            12000,
          )
        } else if (msg.includes('rate') || msg.includes('too many')) {
          showNotification('Demasiados intentos. Probá más tarde.', 'error')
        } else {
          showNotification('No se pudo crear la cuenta. Probá de nuevo en unos minutos.', 'error')
        }
      }
    } else {
      captchaRef.current?.resetCaptcha()
      turnstileRef.current?.reset()
      setCaptchaToken(null)
      const user = session?.user ?? null
      if (cancelledRef.current) return
      if (session && user) {
        const baseSlug = (displayName.trim() || normalizedEmail.split('@')[0] || 'user')
          .toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
        const slug = baseSlug + '-' + user.id.slice(0, 6)
        const { error: profileErr } = await supabaseFetch(
          `profiles?id=eq.${encodeURIComponent(user.id)}`,
          {
            method: 'PATCH',
            body: {
              phone: finalPhone,
              full_name: displayName.trim() || null,
              profile_slug: slug,
            },
            noReturn: true,
          },
        )
        if (profileErr) console.error('[auth-register] profile setup failed', profileErr)

        try {
          const finalizeRes = await fetch('/api/auth/finalize-signup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              context: 'signup',
              terms_accepted: true,
              privacy_accepted: true,
            }),
          })
          if (!finalizeRes.ok) {
            const detail = await finalizeRes.json().catch(() => null)
            console.error('[auth-register] finalize-signup failed', { status: finalizeRes.status, detail })
          }
        } catch (err) {
          console.error('[auth-register] finalize-signup network error', err)
        }
      }
      setSuccessMsg('Revisa tu correo para confirmar la cuenta.')
      setTimeout(() => router.push('/ingresar'), 4000)
    }
    setLoading(false)
  }

  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        .v-fadein{opacity:0;animation:fadeUp .9s cubic-bezier(.22,1,.36,1) forwards}
        .d1{animation-delay:.1s}.d2{animation-delay:.25s}.d3{animation-delay:.4s}
        .d4{animation-delay:.55s}.d5{animation-delay:.7s}.d6{animation-delay:.85s}

        /* Rebranded auth: border-radius 2px → 6/999px, sentence-case labels,
           pill CTAs, inline error banner. Mirrors /ingresar/page.tsx — if one
           changes, change the other. */
        .v-input{
          width:100%;background:var(--v-bg-base);border:1px solid rgba(37, 99, 235,0.15);
          padding:12px 13px 11px;border-radius:6px;outline:none;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:13.5px;font-weight:400;
          color:var(--v-text-primary);transition:border-color .15s ease, background .15s ease;
        }
        .v-input::placeholder{color:var(--v-text-tertiary)}
        .v-input:focus{border-color:var(--v-accent);background:rgba(37, 99, 235,0.04)}

        /* !important needed because globals.css defines a global .v-label
           with text-transform: uppercase + letter-spacing: .18em, and the
           mobile media query (max-width:640px) reinforces it with
           !important. Without these overrides the labels render uppercase
           even though the JSX says sentence case. */
        .v-label{
          display:block;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:500;
          letter-spacing:0.005em !important;color:var(--v-text-primary,#fff);
          text-transform:none !important;
          margin-bottom:8px;
        }

        .v-btn-primary{
          width:100%;background:var(--v-accent);color:#FFFFFF;padding:14px 16px 13px;
          border-radius:999px;border:none;cursor:pointer;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:600;
          letter-spacing:0.08em;text-transform:uppercase;
          transition:background .2s ease;
          display:inline-flex;align-items:center;justify-content:center;gap:10px;
        }
        .v-btn-primary:hover{background:var(--v-accent-light)}
        .v-btn-primary:disabled{background:rgba(37, 99, 235,0.2);color:var(--v-text-tertiary);cursor:not-allowed}
        .v-btn-primary.v-btn--loading{background:rgba(37, 99, 235,0.08);border:1px solid rgba(37, 99, 235,0.25);color:var(--v-accent)}

        .v-spinner-mini{
          width:14px;height:14px;position:relative;display:inline-block;
        }
        .v-spinner-mini::after{
          content:"";position:absolute;inset:0;
          border:1.5px solid rgba(37, 99, 235,0.3);
          border-top-color:var(--v-accent);
          border-radius:50%;
          animation:vSpin .8s linear infinite;
        }
        @keyframes vSpin{to{transform:rotate(360deg)}}

        .v-err-banner{
          background:rgba(199,90,90,0.08);
          border:1px solid rgba(199,90,90,0.28);
          border-radius:6px;
          padding:11px 13px;
          margin-bottom:16px;
          display:flex;gap:10px;align-items:flex-start;
        }
        .v-err-banner-ttl{
          color:#e3a4a4;font-size:12px;font-weight:500;line-height:1.2;
        }

        /* Visually valid email — subtle green border + tint bg. Visual cue
           only; the real validation happens in signUp/check-availability. */
        .v-input--valid{
          border-color:rgba(106,176,106,0.4) !important;
          background:rgba(106,176,106,0.04) !important;
        }

        /* Local toast fade-in without translateX (avoids off-centering in the flex parent). */
        @keyframes vToastFadeIn{
          from{opacity:0;transform:translateY(-12px)}
          to{opacity:1;transform:translateY(0)}
        }
        .v-toast-fade-in{animation:vToastFadeIn .4s ease forwards}

        .v-btn-ghost{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:12.5px;font-weight:500;
          letter-spacing:0.005em;color:var(--v-text-primary,#fff);
          border:1px solid rgba(37, 99, 235,0.15);padding:12px 16px 11px;
          border-radius:999px;transition:color .2s ease,border-color .2s ease,background .2s ease;
          text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:10px;
          background:transparent;
        }
        .v-btn-ghost:hover{color:var(--v-accent);border-color:rgba(37, 99, 235,0.4);background:rgba(37, 99, 235,0.04)}

        .v-phone-btn{
          background:var(--v-bg-base);border:1px solid rgba(37, 99, 235,0.1);
          padding:14px 16px;border-radius:2px;outline:none;cursor:pointer;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:400;
          color:var(--v-accent-strong);display:flex;align-items:center;gap:8px;
          transition:border-color .4s ease;flex-shrink:0;width:120px;
        }
        .v-phone-btn:hover{border-color:rgba(37, 99, 235,0.3)}

        .v-dropdown{
          position:absolute;top:calc(100% + 6px);left:0;width:240px;
          background:var(--v-bg-card);border:1px solid rgba(37, 99, 235,0.3);
          border-radius:2px;z-index:1000;
          box-shadow:0 8px 24px rgba(0,0,0,0.18);
          max-height:200px;overflow-y:auto;
          color:var(--v-text-primary);
          animation:fadeUp .3s ease forwards;
        }
        .v-dropdown-item{
          width:100%;display:flex;align-items:center;gap:12px;padding:8px 12px;
          background:var(--v-bg-card);border:none;cursor:pointer;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:400;
          color:var(--v-text-primary);
          transition:background .3s ease,color .3s ease;
        }
        .v-dropdown-item:hover{background:var(--v-bg-hover);color:var(--v-accent-strong)}

        .v-toggle{
          position:absolute;right:12px;top:50%;transform:translateY(-50%);
          background:transparent;border:none;cursor:pointer;padding:4px;
          color:var(--v-text-tertiary);transition:color .3s ease;display:flex;align-items:center;
        }
        .v-toggle:hover{color:var(--v-accent-strong)}

        @keyframes lineExpand{from{transform:scaleX(0)}to{transform:scaleX(1)}}
        .v-line{
          display:block;height:1px;
          background:linear-gradient(90deg,transparent,var(--v-accent) 40%,var(--v-accent-light) 60%,transparent);
          transform-origin:left;animation:lineExpand 1.2s cubic-bezier(.22,1,.36,1) .3s forwards;
          transform:scaleX(0);
        }
      `}</style>

      <div className="min-h-screen flex items-center justify-center bg-[var(--v-bg-base)] p-3 sm:p-6 relative">

        {statusMsg && statusMsg.type === 'success' && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-6 pointer-events-none">
            <div
              role="status"
              aria-live="polite"
              className="v-toast-fade-in pointer-events-auto rounded-[6px] px-6 py-3.5 max-w-[90vw] sm:max-w-md text-center border border-[rgba(37,99,235,0.35)] bg-[rgba(15,12,8,0.96)] backdrop-blur-md text-[var(--v-accent)] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[13px] font-medium shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]"
            >
              {statusMsg.text}
            </div>
          </div>
        )}

        <div className="v-fadein d2 w-full max-w-[400px] sm:max-w-[460px] p-5 sm:p-10 bg-[var(--v-bg-card)] rounded-[8px] border border-[rgba(37,99,235,0.1)]">
          <div className="flex gap-1 border border-[rgba(37,99,235,0.12)] rounded-[6px] p-1 mb-4 sm:mb-6">
            <Link
              href="/ingresar"
              className="flex-1 text-center px-3 py-2 sm:py-2.5 rounded-[4px] text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] hover:bg-[rgba(37,99,235,0.04)] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-medium tracking-[.06em] uppercase transition-colors no-underline"
            >
              Ingresar
            </Link>
            <span
              aria-current="page"
              className="flex-1 text-center px-3 py-2 sm:py-2.5 rounded-[4px] bg-[rgba(37,99,235,0.08)] text-[var(--v-accent-strong)] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-medium tracking-[.06em] uppercase"
            >
              Crear cuenta
            </span>
          </div>

          {statusMsg && statusMsg.type === 'error' && (
            <div className="v-err-banner v-fadein">
              <span className="text-[var(--v-error)] mt-[1px] shrink-0">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v6M12 17h.01" />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <div className="v-err-banner-ttl">{statusMsg.text}</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mb-3 sm:mb-4">
            <button
              type="button"
              onClick={() => {
                const callbackUrl = explicitRedirect
                  ? `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(explicitRedirect)}`
                  : `${window.location.origin}/auth/callback`
                // Fire-and-forget: signInWithOAuth is async (PKCE handshake)
                // and navigates the tab itself once ready.
                void signInWithOAuth({ provider: 'google', redirectTo: callbackUrl, queryParams: { prompt: 'select_account' } })
              }}
              className="v-btn-ghost !rounded-[6px] !py-[9px] sm:!py-[12px]"
            >
              <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Google
            </button>
            <button
              type="button"
              onClick={() => showNotification('Apple Sign In: en implementación', 'success')}
              className="v-btn-ghost !rounded-[6px] !py-[9px] sm:!py-[12px]"
              aria-label="Apple Sign In — en implementación"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              Apple
            </button>
          </div>

          <div className="flex items-center gap-3 mb-4 sm:mb-5">
            <div className="flex-1 h-px bg-[rgba(37,99,235,0.08)]" />
            <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11.5px] font-normal text-[var(--v-text-tertiary)]">
              O registrate con email
            </span>
            <div className="flex-1 h-px bg-[rgba(37,99,235,0.08)]" />
          </div>

          <SecurityAccordion />

          <form onSubmit={handleRegister} className="flex flex-col gap-3 sm:gap-4">

            <div className="v-fadein d3">
              <label className="v-label" htmlFor="reg-email">Correo</label>
              <div className="relative">
                <input
                  id="reg-email"
                  type="email"
                  placeholder="tu@email.com"
                  className={`v-input w-full box-border pr-10 ${EMAIL_VALID_RE.test(email) ? 'v-input--valid' : ''}`}
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
                {EMAIL_VALID_RE.test(email) && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--v-success)] pointer-events-none" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </div>
            </div>

            <div className="v-fadein d3">
              <label className="v-label" htmlFor="reg-name">
                Nombre o Apodo{' '}
                <span className="text-[var(--v-text-tertiary)] font-normal normal-case tracking-normal ml-1">(Opcional)</span>
              </label>
              <input
                id="reg-name"
                type="text"
                placeholder="Como quieres que te conozcan"
                className="v-input"
                autoComplete="nickname"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                maxLength={30}
              />
              <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal text-[var(--v-text-tertiary)] mt-1.5 leading-[1.6]">
                Aparecerá en tus reseñas y perfil público. No uses tu nombre real si prefieres privacidad.
              </p>
            </div>

            <div className="v-fadein d3">
              <label className="v-label">Teléfono</label>
              <div className="flex gap-2 relative">
                <CountryCodePicker
                  value={selectedCountry}
                  onChange={setSelectedCountry}
                />
                <input
                  id="reg-phone"
                  type="tel"
                  placeholder="9 1234 5678"
                  className="v-input"
                  autoComplete="tel-national"
                  inputMode="numeric"
                  maxLength={selectedCountry.maxDigits ?? 15}
                  value={phoneNumber}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '')
                    const max = selectedCountry.maxDigits ?? 15
                    setPhoneNumber(digits.slice(0, max))
                    if (phoneError) setPhoneError(null)
                  }}
                  required
                />
              </div>
              {phoneError && (
                <p className="text-[var(--v-accent-strong)] text-[10px] mt-1 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] font-normal">
                  {phoneError}
                </p>
              )}
            </div>

            <div className="v-fadein d4">
              <label className="v-label" htmlFor="reg-password">Contraseña</label>
              <div className="relative">
              <input
                id="reg-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                className="v-input w-full box-border tracking-[.1em] pr-[52px]"
                autoComplete="new-password"
                onChange={e => { setPassword(e.target.value); setPwdError(null) }}
                minLength={8}
                required
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="v-toggle" aria-label="Toggle password visibility">
                {showPassword
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
              </div>
              {password.length > 0 ? (
                <div className="mt-2">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map(level => {
                      const active = passwordStrength(password) >= level
                      const color = passwordStrength(password) >= 4
                        ? 'var(--v-success)'
                        : passwordStrength(password) >= 3
                          ? 'var(--v-accent)'
                          : passwordStrength(password) >= 2
                            ? 'var(--v-warn,#d4954c)'
                            : 'var(--v-error)'
                      return (
                        <span
                          key={level}
                          className="flex-1 h-[3px] rounded-[2px] transition-colors"
                          style={{ background: active ? color : 'rgba(37, 99, 235,0.12)' }}
                        />
                      )
                    })}
                  </div>
                  <p className={`font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-normal leading-[1.5] mt-1.5 ${pwdError ? 'text-[var(--v-error)]' : 'text-[var(--v-text-secondary)]'}`}>
                    {pwdError ?? (
                      <>
                        Fuerza:{' '}
                        <span className="font-medium" style={{
                          color: passwordStrength(password) >= 4
                            ? 'var(--v-success)'
                            : passwordStrength(password) >= 3
                              ? 'var(--v-accent-strong)'
                              : passwordStrength(password) >= 2
                                ? 'var(--v-warn,#d4954c)'
                                : 'var(--v-error)',
                        }}>
                          {passwordStrength(password) >= 4 ? 'Fuerte'
                            : passwordStrength(password) >= 3 ? 'Buena'
                            : passwordStrength(password) >= 2 ? 'Media'
                            : 'Débil'}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-normal leading-[1.5] mt-2 text-[var(--v-text-tertiary)]">
                  Al menos 8 caracteres con mayúscula, minúscula, número y símbolo. Ej: Marketplace2026!
                </p>
              )}
            </div>

            {successMsg && (
              <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-normal leading-[1.5] text-[var(--v-success)] bg-[rgba(106,176,106,0.06)] border border-[rgba(106,176,106,0.25)] rounded-[2px] px-3.5 py-3 text-center">
                ✓ {successMsg}
              </p>
            )}

            <div className={`v-fadein d5 flex flex-col gap-3 mb-0 ${useAcceptAll ? 'v-consents--locked' : ''}`}>
              <div className="flex items-start gap-2.5 pb-3 border-b border-[rgba(37,99,235,0.15)]">
                <input
                  type="checkbox"
                  id="reg-accept-all"
                  className="v-privacy-check"
                  checked={useAcceptAll}
                  onChange={e => handleAcceptAll(e.target.checked)}
                />
                <label htmlFor="reg-accept-all" className="text-[12px] text-[var(--v-accent-strong)] font-medium leading-[1.6] cursor-pointer font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif]">
                  Aceptar todo
                </label>
              </div>
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="reg-terms"
                  className="v-privacy-check"
                  checked={termsAccepted}
                  disabled={useAcceptAll}
                  onChange={e => setTermsAccepted(e.target.checked)}
                />
                <label htmlFor="reg-terms" className={`text-[11px] leading-[1.6] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] font-normal ${useAcceptAll ? 'text-[var(--v-text-tertiary)] cursor-not-allowed' : 'text-[var(--v-text-secondary)] cursor-pointer'}`}>
                  Acepto los{' '}
                  <Link href="/terminos" target="_blank" className="text-[var(--v-accent-strong)] underline">
                    Términos y Condiciones
                  </Link>
                </label>
              </div>
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="reg-privacy"
                  className="v-privacy-check"
                  checked={privacyAccepted}
                  disabled={useAcceptAll}
                  onChange={e => setPrivacyAccepted(e.target.checked)}
                />
                <label htmlFor="reg-privacy" className={`text-[11px] leading-[1.6] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] font-normal ${useAcceptAll ? 'text-[var(--v-text-tertiary)] cursor-not-allowed' : 'text-[var(--v-text-secondary)] cursor-pointer'}`}>
                  Acepto la{' '}
                  <Link href="/privacidad" target="_blank" className="text-[var(--v-accent-strong)] underline">
                    Política de Privacidad
                  </Link>
                </label>
              </div>
              <style>{`
                .v-privacy-check {
                  appearance: none; -webkit-appearance: none;
                  width: 18px !important; height: 18px !important;
                  min-width: 18px !important; min-height: 18px !important;
                  margin: 3px 0 0 0 !important;
                  border: 1.5px solid rgba(37, 99, 235,0.5);
                  border-radius: 2px;
                  background: transparent;
                  cursor: pointer;
                  flex-shrink: 0;
                  position: relative;
                  transition: border-color .2s ease, background .2s ease;
                }
                .v-privacy-check:hover { border-color: var(--v-accent); }
                .v-privacy-check:checked {
                  background: var(--v-accent); border-color: var(--v-accent);
                }
                .v-privacy-check:checked::after {
                  content: ''; position: absolute;
                  left: 5px; top: 1px; width: 5px; height: 10px;
                  border: solid #FFFFFF; border-width: 0 2px 2px 0;
                  transform: rotate(45deg);
                }
              `}</style>
            </div>

            <div className="v-fadein d6 pt-2 sm:pt-3 flex flex-col gap-2.5 sm:gap-3 items-center">
              {/* Preferred: Cloudflare Turnstile. Fallback: hCaptcha. */}
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
              <button
                type="submit"
                className={`v-btn-primary w-full ${loading ? 'v-btn--loading' : ''}`}
                disabled={loading}
              >
                {loading && <span className="v-spinner-mini" aria-hidden="true" />}
                {loading ? 'Verificando…' : 'Crear cuenta'}
              </button>
              {captchaFails >= 2 && (
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal leading-[1.5] text-[var(--v-accent-strong)] text-center mt-1">
                  Si el captcha no responde, registrate con Google arriba — funciona igual.
                </p>
              )}
            </div>
          </form>

          <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11.5px] font-light leading-[1.45] text-[var(--v-text-secondary)] mt-4 text-center">
            Al crear cuenta aceptás los{' '}
            <Link href="/terminos" className="text-[var(--v-accent-strong)] border-b border-[rgba(var(--brand-primary-rgb),0.3)] border-dotted">Términos</Link>{' '}y la{' '}
            <Link href="/privacidad" className="text-[var(--v-accent-strong)] border-b border-[rgba(var(--brand-primary-rgb),0.3)] border-dotted">Privacidad</Link>.
          </p>
        </div>
      </div>

    </>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--v-bg-base)]" />}>
      <RegisterForm />
    </Suspense>
  )
}
