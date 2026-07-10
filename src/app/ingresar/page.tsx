'use client'
import { signInWithPassword, signInWithOAuth, supabaseFetch } from '@/lib/supabase/direct'
import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { Turnstile, TurnstileInstance } from '@marsidev/react-turnstile'
import { safeRedirectPath } from '@/lib/safe-redirect'

const EMAIL_VALID_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const LOGIN_MAX_ATTEMPTS = 5

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ text: string, type: 'success' | 'error' } | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [rememberMe, setRememberMe] = useState(true)
  // Unmount guard — if the user navigates away mid-submit, bail before
  // setState. The Supabase SDK doesn't accept AbortSignal, so the flag is
  // the idiomatic pattern.
  const cancelledRef = useRef(false)
  useEffect(() => () => { cancelledRef.current = true }, [])
  // Incrementing key remounts the Turnstile widget from scratch — the only
  // reliable way to recover when Firefox loses the WebGL context or the
  // widget sticks after a "consumed token" error. `reset()` alone is insufficient.
  const [captchaKey, setCaptchaKey] = useState(0)
  // Track consecutive captcha failures. After 2 we surface the Google OAuth
  // fallback — Turnstile fails persistently in browsers with WebGL issues
  // (notably Firefox after a context loss) and widget resets won't recover.
  const [captchaFails, setCaptchaFails] = useState(0)
  // Widget-level captcha errors (network blip, challenge fail, hostname not
  // whitelisted). Distinct from captchaFails, which counts *submit* rejections.
  // The auto-remounts are capped: a persistently-failing widget used to loop
  // hardResetCaptcha() forever, leaving the user stuck behind a disabled submit
  // (you can't submit without a token). After the cap we surface a manual retry.
  const captchaErrorCount = useRef(0)
  const [captchaBroken, setCaptchaBroken] = useState(false)
  const [loginFailures, setLoginFailures] = useState(0)
  const captchaRef = useRef<HCaptcha>(null)
  const turnstileRef = useRef<TurnstileInstance>(null)

  const hardResetCaptcha = () => {
    setCaptchaToken(null)
    setCaptchaKey(k => k + 1)
  }
  const retryCaptcha = () => {
    captchaErrorCount.current = 0
    setCaptchaBroken(false)
    hardResetCaptcha()
  }
  const router = useRouter()
  const searchParams = useSearchParams()
  // Whitelist post-auth destinations; anything off-list falls back to
  // /dashboard — keeps crafted links from landing users on internal pages.
  const rawRedirect = searchParams.get('redirect')
  const redirect = safeRedirectPath(rawRedirect, '/dashboard')
  // Same validation but returns '' when there's no explicit (or off-list)
  // redirect. Lets the OAuth callback apply its role-based default instead
  // of pinning /dashboard when the caller didn't ask for one.
  const explicitRedirect = rawRedirect ? safeRedirectPath(rawRedirect, '') : ''

  const showNotification = (text: string, type: 'success' | 'error') => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 4000);
  }

  // IdleLogout redirects here with ?expired=1 after 15 min of inactivity —
  // surface the reason so the login screen doesn't appear out of nowhere.
  useEffect(() => {
    if (searchParams.get('expired') === '1') {
      setStatusMsg({ text: 'Sesión cerrada por inactividad', type: 'error' })
      setTimeout(() => setStatusMsg(null), 6000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!captchaToken) {
      showNotification('Completá el captcha', 'error')
      return
    }
    setLoading(true)

    // Normalize email before sending — Supabase stores lowercase, and a
    // capitalized input can fail the server-side compare. Trim catches
    // trailing-space paste too.
    const normalizedEmail = email.trim().toLowerCase()

    // Pre-auth brute-force gate (5 attempts per IP+email per 5 min) on top of
    // middleware's rate limit + Supabase captcha. Fail-open on non-429 so a
    // transient gate outage doesn't lock users out.
    try {
      const gateRes = await fetch('/api/auth/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', email: normalizedEmail }),
      })
      if (cancelledRef.current) return
      if (gateRes.status === 429) {
        const data = await gateRes.json().catch(() => ({ error: 'Demasiados intentos. Probá más tarde.' }))
        showNotification(data.error || 'Demasiados intentos. Probá más tarde.', 'error')
        setLoading(false)
        return
      }
    } catch (err) {
      console.error('[auth-login] gate call failed, proceeding anyway', err)
    }

    // Direct POST to /auth/v1/token — bypass the @supabase/ssr SDK lock. The
    // SDK's signInWithPassword queues behind navigator.locks, and a stale
    // auth-token mutex leaves the submit stuck forever with no request fired.
    const { data: { session }, error: loginError } = await signInWithPassword({
      email: normalizedEmail, password, captchaToken,
    })
    const user = session?.user ?? null

    if (cancelledRef.current) return

    if (loginError) {
      const raw = loginError.message || ''
      // "invalid-input-response" fires when the Turnstile token expired or got
      // consumed. Hard-remount the widget (key++) because the soft reset() is
      // unreliable in Firefox once WebGL has glitched.
      const isCaptcha = /captcha/i.test(raw) || /invalid-input-response/i.test(raw)
      if (isCaptcha) {
        hardResetCaptcha()
        setCaptchaFails(n => n + 1)
      } else {
        captchaRef.current?.resetCaptcha()
        turnstileRef.current?.reset()
        setCaptchaToken(null)
      }
      const nextFails = isCaptcha ? captchaFails + 1 : captchaFails
      const isBadCredentials = raw === 'Invalid login credentials'
      if (isBadCredentials) {
        setLoginFailures(n => n + 1)
      }
      const message = isCaptcha
        ? nextFails >= 2
          ? 'El captcha sigue fallando. Usá "Continuar con Google" abajo — es más rápido.'
          : 'Captcha expirado. Se está recargando — esperá unos segundos y volvé a intentar.'
        : isBadCredentials
          ? 'Contraseña incorrecta'
          : raw
      showNotification(message, 'error')
      setLoading(false)
      return
    }

    captchaRef.current?.resetCaptcha()
    turnstileRef.current?.reset()
    setCaptchaToken(null)

    if (user) {
      setLoginFailures(0)
      const { data: profile, error: profileError } = await supabaseFetch<{ is_admin: boolean }>(
        `profiles?select=is_admin&id=eq.${encodeURIComponent(user.id)}`,
        { single: true },
      )

      if (cancelledRef.current) return

      const target = profileError
        ? redirect
        : profile?.is_admin ? '/admin' : redirect
      if (profileError) {
        console.error('[auth-login] profile lookup failed after auth', profileError)
      }
      // router.push is safe now that the SDK's lock is a no-op — the client
      // SDK picks up the new auth cookie on its next call. window.location.href
      // used to be required but triggered a hydration mismatch (React #418) on /admin.
      router.push(target)
    }
  }

  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        .v-fadein{opacity:0;animation:fadeUp .9s cubic-bezier(.22,1,.36,1) forwards}
        .d1{animation-delay:.1s}.d2{animation-delay:.25s}.d3{animation-delay:.4s}
        .d4{animation-delay:.55s}.d5{animation-delay:.7s}

        /* Rebranded auth: border-radius 2px → 8px, inputs with a subtle
           accent focus bg, sentence-case labels (no uppercase), rounded-full
           CTA pill. Marketplace wordmark replaces the PNG logo. */
        .v-input{
          width:100%;background:var(--v-bg-base);border:1px solid rgba(37, 99, 235,0.15);
          padding:12px 13px 11px;border-radius:6px;outline:none;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:13.5px;font-weight:400;
          color:var(--v-text-primary);transition:border-color .15s ease, background .15s ease;
        }
        .v-input::placeholder{color:var(--v-text-tertiary)}
        .v-input:focus{border-color:var(--v-accent);background:rgba(37, 99, 235,0.04)}
        .v-input.v-input--error{border-color:rgba(199,90,90,0.45);background:rgba(199,90,90,0.04)}
        .v-input--valid{border-color:rgba(106,176,106,0.4) !important;background:rgba(106,176,106,0.04) !important;}

        /* !important needed because globals.css defines a global .v-label
           with text-transform: uppercase and the mobile media query
           reinforces it with !important. Without the override the labels
           render uppercase even though the JSX says sentence case. */
        .v-label{
          display:block;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:500;
          letter-spacing:0.005em !important;color:var(--v-text-primary,#fff);
          text-transform:none !important;
          margin-bottom:8px;
        }

        .v-btn-ghost{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:12.5px;font-weight:500;
          letter-spacing:0.005em;color:var(--v-text-primary,#fff);
          border:1px solid rgba(37, 99, 235,0.15);padding:12px 16px 11px;
          border-radius:999px;transition:color .2s ease,border-color .2s ease,background .2s ease;
          text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:10px;
          background:transparent;
        }
        .v-btn-ghost:hover{color:var(--v-accent);border-color:rgba(37, 99, 235,0.4);background:rgba(37, 99, 235,0.04)}

        .v-btn-primary{
          width:100%;background:var(--v-accent);color:#ffffff;padding:14px 16px 13px;
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
        .v-err-banner-sub{
          color:var(--v-text-secondary);font-size:10.5px;margin-top:3px;font-weight:300;line-height:1.4;
        }

        /* Local toast fade-in — no translateX(-50%) (the global .v-toast-in
           does that with absolute left:50%, which doesn't apply here because
           we're already centered via flex). */
        @keyframes vToastFadeIn{
          from{opacity:0;transform:translateY(-12px)}
          to{opacity:1;transform:translateY(0)}
        }
        .v-toast-fade-in{animation:vToastFadeIn .4s ease forwards}

        /* "Mantenerme conectada" checkbox — 14×14px (vs the original 16,
           which looked relatively large on mobile against the label's
           text-[12px]). !important forces the size against the mobile
           user-agent rules for input[type=checkbox]. */
        .v-remember-check{
          appearance:none !important;-webkit-appearance:none !important;
          width:14px !important;height:14px !important;
          min-width:14px !important;min-height:14px !important;
          max-width:14px !important;max-height:14px !important;
          margin:0 !important;padding:0 !important;
          border:1px solid rgba(37, 99, 235,0.4);
          border-radius:3px;
          background:var(--v-bg-base);
          cursor:pointer;
          position:relative;
          transition:border-color .15s ease, background .15s ease;
          flex-shrink:0;
          box-sizing:border-box;
        }
        .v-remember-check:hover{border-color:var(--v-accent);}
        .v-remember-check:checked{background:var(--v-accent);border-color:var(--v-accent);}
        .v-remember-check:checked::after{
          content:'';position:absolute;
          left:4px;top:0;width:4px;height:8px;
          border:solid #ffffff;border-width:0 2px 2px 0;
          transform:rotate(45deg);
        }

        @keyframes lineExpand{from{transform:scaleX(0)}to{transform:scaleX(1)}}
        .v-line{
          display:block;height:1px;
          background:linear-gradient(90deg,transparent,var(--v-accent) 40%,var(--v-accent-light) 60%,transparent);
          transform-origin:left;animation:lineExpand 1.2s cubic-bezier(.22,1,.36,1) .3s forwards;
          transform:scaleX(0);
        }
      `}</style>

      <div className="min-h-screen flex flex-col bg-[var(--v-bg-base)] relative">

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

        <div className="flex-1 flex items-center justify-center w-full p-3 sm:p-6">
        <div className="v-fadein d2 w-full max-w-[400px] sm:max-w-[440px] p-5 sm:p-10 bg-[var(--v-bg-card)] rounded-[8px] border border-[rgba(37,99,235,0.1)]">
          <div className="flex gap-1 border border-[rgba(37,99,235,0.12)] rounded-[6px] p-1 mb-4 sm:mb-6">
            <span
              aria-current="page"
              className="flex-1 text-center px-3 py-2 sm:py-2.5 rounded-[4px] bg-[rgba(37,99,235,0.08)] text-[var(--v-accent-strong)] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-medium tracking-[.06em] uppercase"
            >
              Ingresar
            </span>
            <Link
              href="/registro"
              className="flex-1 text-center px-3 py-2 sm:py-2.5 rounded-[4px] text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] hover:bg-[rgba(37,99,235,0.04)] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-medium tracking-[.06em] uppercase transition-colors no-underline"
            >
              Crear cuenta
            </Link>
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
                {loginFailures > 0 && loginFailures < LOGIN_MAX_ATTEMPTS && (
                  <div className="v-err-banner-sub">
                    {LOGIN_MAX_ATTEMPTS - loginFailures} intento{LOGIN_MAX_ATTEMPTS - loginFailures !== 1 ? 's' : ''} restante{LOGIN_MAX_ATTEMPTS - loginFailures !== 1 ? 's' : ''} antes del bloqueo temporal.
                  </div>
                )}
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
                // Fire-and-forget: signInWithOAuth navigates the tab itself once the PKCE handshake is ready.
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
            <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-medium tracking-[.18em] uppercase text-[var(--v-text-tertiary)]">
              o continuar con email
            </span>
            <div className="flex-1 h-px bg-[rgba(37,99,235,0.08)]" />
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-3 sm:gap-4">
            <div className="v-fadein d3">
              <label className="v-label" htmlFor="login-email">Correo</label>
              <div className="relative">
                <input
                  id="login-email"
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
              <label className="v-label" htmlFor="login-password">Contraseña</label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  className="v-input w-full box-border tracking-[.18em] pr-11"
                  autoComplete="current-password"
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0 w-5 h-5 flex items-center justify-center bg-transparent border-none cursor-pointer text-[var(--v-text-tertiary)] hover:text-[var(--v-accent-strong)] transition-colors"
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 -mt-1 mb-1">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="v-remember-check"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  aria-label="Mantenerme conectada"
                />
                <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-normal text-[var(--v-text-primary)]">
                  Mantenerme conectada
                </span>
              </label>
              <Link
                href="/recuperar"
                className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11.5px] font-normal text-[var(--v-accent-strong)] hover:underline transition-colors self-start"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>

            <div className="v-fadein d4 pt-2 sm:pt-3 flex flex-col gap-2.5 sm:gap-3 items-center">
              {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? (
                <Turnstile
                  key={captchaKey}
                  ref={turnstileRef}
                  siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                  onSuccess={(token) => { captchaErrorCount.current = 0; setCaptchaBroken(false); setCaptchaToken(token) }}
                  onExpire={() => { setCaptchaToken(null); turnstileRef.current?.reset() }}
                  onError={() => {
                    captchaErrorCount.current += 1
                    if (captchaErrorCount.current <= 2) {
                      // Transient — remount once to recover (Firefox WebGL loss / consumed token). Capped so we don't loop.
                      hardResetCaptcha()
                    } else {
                      // Persistent failure — stop remounting; surface a manual retry + the Google fallback.
                      setCaptchaToken(null)
                      setCaptchaBroken(true)
                      setCaptchaFails(n => Math.max(n, 2))
                    }
                  }}
                  // refreshExpired=auto: Turnstile regenerates the token near
                  // its 5-minute TTL so long-idle forms don't submit a stale one.
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
              {captchaBroken && (
                <button
                  type="button"
                  onClick={retryCaptcha}
                  className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-medium text-[var(--v-accent-strong)] underline underline-offset-2 hover:opacity-80 transition-opacity"
                >
                  El captcha no responde — reintentar
                </button>
              )}
              <button
                type="submit"
                className={`v-btn-primary ${loading ? 'v-btn--loading' : ''}`}
                disabled={loading || !captchaToken}
              >
                {loading && <span className="v-spinner-mini" aria-hidden="true" />}
                {loading ? 'Verificando…' : 'Ingresar'}
              </button>
              {(captchaFails >= 2 || captchaBroken) && (
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal leading-[1.5] text-[var(--v-accent)] text-center mt-1">
                  Si el captcha no responde, ingresá con Google arriba — funciona igual.
                </p>
              )}
            </div>
          </form>

          <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11.5px] font-light leading-[1.45] text-[var(--v-text-secondary)] mt-4 text-center">
            Al ingresar aceptás los{' '}
            <Link href="/terminos" className="text-[var(--v-accent-strong)] border-b border-[rgba(var(--brand-primary-rgb),0.3)] border-dotted">Términos</Link>{' '}y la{' '}
            <Link href="/privacidad" className="text-[var(--v-accent-strong)] border-b border-[rgba(var(--brand-primary-rgb),0.3)] border-dotted">Privacidad</Link>.
          </p>

        </div>
        </div>
      </div>
    </>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--v-bg-base)]" />}>
      <LoginForm />
    </Suspense>
  )
}
