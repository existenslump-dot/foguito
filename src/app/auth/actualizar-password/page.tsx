'use client'
import { updateUserPassword, getAccessToken, signOut } from '@/lib/supabase/direct'
import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import MarketplaceWordmark from '@/components/MarketplaceWordmark'
import SiteFooter from '@/components/SiteFooter'

function UpdatePasswordForm() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ text: string, type: 'success' | 'error' } | null>(null)
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [hasSession, setHasSession] = useState<boolean | null>(null)

  useEffect(() => {
    setHasSession(getAccessToken() !== null)
  }, [])

  const showNotification = (text: string, type: 'success' | 'error') => {
    setStatusMsg({ text, type })
    setTimeout(() => setStatusMsg(null), 5000)
  }

  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 8) return 'La contraseña debe tener al menos 8 caracteres'
    if (!/[A-Z]/.test(pwd)) return 'Debe incluir al menos una letra mayúscula'
    if (!/[a-z]/.test(pwd)) return 'Debe incluir al menos una letra minúscula'
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?¡¿~`·]/.test(pwd)) return 'Debe incluir al menos un caracter especial (!@#$...)'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwdError(null)

    const pwdRuleError = validatePassword(password)
    if (pwdRuleError) { setPwdError(pwdRuleError); return }
    if (password !== confirmPassword) {
      setPwdError('Las contraseñas no coinciden')
      return
    }

    setLoading(true)
    const { error } = await updateUserPassword({ password })

    if (error) {
      const raw = error.message || ''
      const msg = raw.toLowerCase()
      console.error('[auth-update-password] update failed', error)
      let userMsg: string
      if (msg.includes('same') || msg.includes('different')) {
        userMsg = 'La nueva contraseña no puede ser igual a la anterior.'
      } else if (msg.includes('leaked') || msg.includes('pwned') || msg.includes('common') || msg.includes('breach')) {
        userMsg = 'Esta contraseña apareció en una filtración de datos pública. Elegí una distinta (no uses combinaciones comunes como "Password123!").'
      } else if (msg.includes('characters') || msg.includes('length') || msg.includes('digit') || msg.includes('uppercase') || msg.includes('lowercase') || msg.includes('symbol')) {
        userMsg = `${raw} (Mínimo: 8 caracteres con mayúscula, minúscula, número y símbolo.)`
      } else if (msg.includes('weak') || msg.includes('password')) {
        userMsg = `Contraseña inválida: ${raw}. Probá una más larga con mayúsculas, minúsculas, números y símbolos.`
      } else if (error.status === 401 || msg.includes('session') || msg.includes('token')) {
        showNotification('Tu enlace expiró. Pedí uno nuevo en "Olvidé mi contraseña".', 'error')
        setLoading(false)
        return
      } else {
        userMsg = 'No pudimos actualizar la contraseña. Intentá de nuevo.'
      }
      setPwdError(userMsg)
      setLoading(false)
      return
    }

    try { await signOut() } catch { /* ignore */ }
    setDone(true)
    setLoading(false)
    setTimeout(() => router.push('/ingresar'), 3500)
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
                Nueva Contraseña
              </p>
            </div>

            {done ? (
              <div className="flex flex-col items-center gap-5 text-center">
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-normal leading-[1.6] text-[var(--v-success)] bg-[rgba(106,176,106,0.06)] border border-[rgba(106,176,106,0.25)] rounded-[2px] px-3.5 py-3">
                  ✓ Contraseña actualizada. Redirigiendo al inicio de sesión...
                </p>
              </div>
            ) : hasSession === false ? (
              <div className="flex flex-col items-center gap-5 text-center">
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-normal leading-[1.6] text-[var(--v-text-primary)]">
                  Este enlace expiró o ya fue usado.
                </p>
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-normal leading-[1.6] text-[var(--v-text-tertiary)]">
                  Pedí uno nuevo desde la pantalla de recuperación.
                </p>
                <Link href="/recuperar" className="v-btn-ghost mt-4">Pedir nuevo enlace</Link>
              </div>
            ) : hasSession === null ? (
              <p className="text-center text-[var(--v-text-tertiary)] text-[11px] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif]">
                Cargando...
              </p>
            ) : (
              <>
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal leading-[1.6] text-[var(--v-text-secondary)] mb-6 text-center">
                  Elegí una contraseña nueva. La próxima vez vas a iniciar sesión con ella.
                </p>
                <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                  <div className="v-fadein d3">
                    <label className="v-label" htmlFor="new-password">Nueva Contraseña</label>
                    <div className="relative">
                      <input
                        id="new-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        className="v-input w-full box-border tracking-[.1em] pr-[52px]"
                        autoComplete="new-password"
                        value={password}
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
                    <p className={`font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-normal leading-[1.5] mt-2 ${pwdError ? 'text-[var(--v-error)]' : 'text-[var(--v-text-tertiary)]'}`}>
                      {pwdError ?? 'Al menos 8 caracteres con mayúscula, minúscula, número y símbolo. Ej: Marketplace2026!'}
                    </p>
                  </div>

                  <div className="v-fadein d3">
                    <label className="v-label" htmlFor="new-password-confirm">Repetir Contraseña</label>
                    <div className="relative">
                      <input
                        id="new-password-confirm"
                        type={showConfirm ? 'text' : 'password'}
                        placeholder="••••••••"
                        className="v-input w-full box-border tracking-[.18em] pr-[52px]"
                        autoComplete="new-password"
                        style={{
                          borderColor: confirmPassword
                            ? (password === confirmPassword ? 'rgba(80,160,80,0.4)' : 'rgba(224,85,85,0.3)')
                            : undefined,
                        }}
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        minLength={6}
                        required
                      />
                      <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="v-toggle" aria-label="Toggle password visibility">
                        {showConfirm
                          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        }
                      </button>
                    </div>
                  </div>

                  <div className="v-fadein d4 pt-2">
                    <button type="submit" className="v-btn-primary" disabled={loading}>
                      {loading ? 'Actualizando...' : 'Guardar contraseña'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>

        <SiteFooter />
      </div>
    </>
  )
}

export default function UpdatePasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--v-bg-base)]" />}>
      <UpdatePasswordForm />
    </Suspense>
  )
}
