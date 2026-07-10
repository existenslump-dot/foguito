'use client'
import { Suspense, useState, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import MarketplaceWordmark from '@/components/MarketplaceWordmark'
import Link from 'next/link'
import { signOut } from '@/lib/supabase/direct'

/**
 * Post-login TOTP verification screen. Reached via the middleware admin-
 * gate when an admin's `last_totp_verified_at` is older than the
 * re-verify TTL (12h). Successful submit refreshes the timestamp
 * server-side and bounces back to the original /admin destination.
 *
 * The verify form sits inside a Suspense boundary because Next 16's
 * static prerender bails on any page that calls `useSearchParams()`
 * outside one — same shape as /ingresar and /registro.
 */
function TotpVerifyForm() {
  const router = useRouter()
  const search = useSearchParams()
  const next = search.get('next') ?? '/admin'

  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [showRecovery, setShowRecovery] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [showRecovery])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const body = showRecovery
        ? { recoveryCode: recoveryCode.trim() }
        : { code: code.trim() }
      const res = await fetch('/api/auth/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'No se pudo verificar')
        setLoading(false)
        return
      }
      router.replace(next.startsWith('/') ? next : '/admin')
    } catch {
      setError('Error de red')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--v-bg-base)] p-6">
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        .v-fadein{opacity:0;animation:fadeUp .9s cubic-bezier(.22,1,.36,1) forwards}
        .v-input{
          width:100%;background:var(--v-bg-base);border:1px solid rgba(37, 99, 235,0.15);
          padding:14px 16px;border-radius:2px;outline:none;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:13px;
          color:var(--v-text-primary);transition:border-color .4s ease;letter-spacing:.32em;text-align:center;
        }
        .v-input:focus{border-color:rgba(37, 99, 235,0.4)}
        .v-label{
          display:block;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:9px;font-weight:400;
          letter-spacing:.22em;text-transform:uppercase;color:var(--v-accent);
          margin-bottom:8px;text-align:center;
        }
        .v-btn-primary{
          width:100%;background:var(--v-accent);color:var(--v-bg-base);padding:16px;
          border-radius:2px;border:none;cursor:pointer;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:500;
          letter-spacing:.18em;text-transform:uppercase;
        }
        .v-btn-primary:disabled{background:rgba(37, 99, 235,0.1);color:rgba(255,255,255,0.5);cursor:not-allowed}
      `}</style>

      <div className="v-fadein w-full max-w-[380px] p-12 bg-[var(--v-bg-card)] rounded-[2px] border border-[rgba(37,99,235,0.1)]">
        <div className="flex flex-col items-center mb-10">
          <MarketplaceWordmark size={28} className="mb-5" />
          <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] tracking-[.26em] uppercase text-[var(--v-accent)] opacity-55 font-normal">
            Verificación · 2FA
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {!showRecovery ? (
            <div>
              <label className="v-label" htmlFor="totp-code">Código de 6 dígitos</label>
              <input
                ref={inputRef}
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="\d{6}"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="v-input"
                placeholder="••••••"
                required
              />
            </div>
          ) : (
            <div>
              <label className="v-label" htmlFor="totp-recovery">Código de recuperación</label>
              <input
                ref={inputRef}
                id="totp-recovery"
                value={recoveryCode}
                onChange={e => setRecoveryCode(e.target.value)}
                className="v-input"
                placeholder="xxxxx-xxxxx"
                style={{ letterSpacing: '.18em' }}
                required
              />
            </div>
          )}

          {error && (
            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] text-[var(--v-error)] text-center">
              {error}
            </p>
          )}

          <button type="submit" className="v-btn-primary" disabled={loading || (!code && !recoveryCode)}>
            {loading ? 'Verificando...' : 'Verificar'}
          </button>

          <button
            type="button"
            onClick={() => { setShowRecovery(s => !s); setError(null); setCode(''); setRecoveryCode('') }}
            className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] bg-transparent border-none cursor-pointer underline underline-offset-2 transition-colors"
          >
            {showRecovery ? 'Usar código del autenticador' : 'Usar código de recuperación'}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-[rgba(37,99,235,0.08)] flex flex-col items-center gap-3">
          <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] text-center leading-relaxed">
            ¿Querés salir sin verificar?
          </p>
          <button
            type="button"
            onClick={async () => { await signOut(); router.replace('/ingresar') }}
            className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal tracking-[.2em] uppercase text-[var(--v-text-secondary)] hover:text-[var(--v-accent)] bg-transparent border border-[rgba(37,99,235,0.15)] hover:border-[rgba(37,99,235,0.4)] cursor-pointer rounded-[2px] px-6 py-3 transition-colors"
          >
            Cerrar sesión
          </button>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/dashboard"
            className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[8px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] hover:text-[var(--v-text-secondary)] transition-colors"
          >
            ← Volver al dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function TotpVerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--v-bg-base)]" />}>
      <TotpVerifyForm />
    </Suspense>
  )
}
