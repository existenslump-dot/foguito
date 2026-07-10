'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { supabase } from '@/lib/supabase/client'
import MarketplaceLoader from '@/components/MarketplaceLoader'

type ProfileFlags = {
  is_admin: boolean
  totp_enabled: boolean
}

type SetupResponse = {
  qrDataUrl: string
  otpauthUri: string
  recoveryCodes: string[]
}

/**
 * Admin security settings — TOTP setup / disable.
 *
 * Flow:
 *   1. Click "Activar 2FA" → POST /api/auth/totp/setup → render QR +
 *      recovery codes. Codes are shown ONCE; the user copies them
 *      somewhere safe before continuing.
 *   2. User scans QR with authenticator app + types the 6-digit code →
 *      POST /api/auth/totp/enable. On success, totp_enabled flips to
 *      true and the page reloads with the "active" state.
 *   3. To disable: type a current code → POST /api/auth/totp/disable.
 */
export default function SecurityPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [flags, setFlags] = useState<ProfileFlags | null>(null)
  const [setup, setSetup] = useState<SetupResponse | null>(null)
  const [enableCode, setEnableCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [recoverySaved, setRecoverySaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/ingresar?redirect=/dashboard/security'); return }
      const { data } = await supabase
        .from('profiles')
        .select('is_admin, totp_enabled')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      if (!data?.is_admin) { router.replace('/dashboard'); return }
      setFlags({ is_admin: data.is_admin, totp_enabled: !!data.totp_enabled })
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [router])

  const startSetup = async () => {
    setError(null); setSuccess(null); setBusy(true); setRecoverySaved(false)
    try {
      const res = await fetch('/api/auth/totp/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'No se pudo iniciar el setup'); setBusy(false); return }
      setSetup(data)
    } catch {
      setError('Error de red')
    }
    setBusy(false)
  }

  const confirmEnable = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      const res = await fetch('/api/auth/totp/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: enableCode }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Código inválido'); setBusy(false); return }
      setSuccess('2FA activado correctamente')
      setSetup(null); setEnableCode('')
      setFlags(f => f ? { ...f, totp_enabled: true } : f)
    } catch {
      setError('Error de red')
    }
    setBusy(false)
  }

  const disable = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      const res = await fetch('/api/auth/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: disableCode }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Código inválido'); setBusy(false); return }
      setSuccess('2FA desactivado')
      setDisableCode('')
      setFlags(f => f ? { ...f, totp_enabled: false } : f)
    } catch {
      setError('Error de red')
    }
    setBusy(false)
  }

  if (loading || !flags) {
    return <div className="min-h-screen bg-[var(--v-bg-base)] flex items-center justify-center"><MarketplaceLoader variant="block" /></div>
  }

  return (
    <div className="min-h-screen bg-[var(--v-bg-base)] text-[var(--v-text-primary)] py-12 px-6">
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        .v-fadein{opacity:0;animation:fadeUp .9s cubic-bezier(.22,1,.36,1) forwards}
        .v-input{
          width:100%;background:var(--v-bg-base);border:1px solid rgba(37, 99, 235,0.15);
          padding:14px 16px;border-radius:6px;outline:none;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:13px;
          color:var(--v-text-primary);letter-spacing:.32em;text-align:center;
        }
        .v-input:focus{border-color:rgba(37, 99, 235,0.4)}
        .v-label{
          display:block;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:9px;font-weight:400;
          letter-spacing:.22em;text-transform:uppercase;color:var(--v-accent);
          margin-bottom:8px;
        }
        .v-btn-primary{
          background:var(--v-accent);color:var(--v-bg-base);padding:14px 24px;
          border-radius:6px;border:none;cursor:pointer;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:10px;font-weight:500;
          letter-spacing:.18em;text-transform:uppercase;
        }
        .v-btn-primary:disabled{background:rgba(37, 99, 235,0.1);color:var(--v-text-tertiary);cursor:not-allowed}
        .v-btn-ghost{
          background:transparent;color:var(--v-text-secondary);padding:14px 24px;
          border-radius:6px;border:1px solid rgba(37, 99, 235,0.15);cursor:pointer;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:10px;font-weight:400;
          letter-spacing:.18em;text-transform:uppercase;
        }
        .v-card{
          border:1px solid rgba(37, 99, 235,0.1);border-radius:6px;
          background:var(--v-bg-card);padding:32px;
        }
      `}</style>

      <div className="v-fadein max-w-[640px] mx-auto">
        {/* Wordmark + back-arrow removed — the global <UserHeader /> already
            carries the brand and the back navigation, so both duplicated the
            chrome on the page. */}
        <h1 className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[28px] font-normal text-[var(--v-text-primary)] mt-2 mb-2">Seguridad</h1>
        <p className="font-['Montserrat',sans-serif] text-[11px] text-[var(--v-text-secondary)] mb-10 leading-relaxed">
          Configurá la autenticación en dos factores (2FA) para tu cuenta de administrador.
        </p>

        {error && (
          <p className="mb-6 px-4 py-3 border border-[rgba(224,85,85,0.25)] bg-[rgba(224,85,85,0.06)] rounded-[6px] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] text-[var(--v-error)]">
            {error}
          </p>
        )}
        {success && (
          <p className="mb-6 px-4 py-3 border border-[rgba(106,176,106,0.25)] bg-[rgba(106,176,106,0.06)] rounded-[6px] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] text-[var(--v-success)]">
            ✓ {success}
          </p>
        )}

        {/* State A — already enabled */}
        {flags.totp_enabled && !setup && (
          <div className="v-card">
            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] tracking-[.22em] uppercase text-[var(--v-success)] mb-4">✓ 2FA ACTIVO</p>
            <p className="font-['Montserrat',sans-serif] text-[11px] text-[var(--v-text-secondary)] leading-relaxed mb-8">
              Tu cuenta requiere código del autenticador para acceder a /admin. Si necesitás desactivarlo, ingresá un código actual abajo.
            </p>
            <form onSubmit={disable} className="flex flex-col gap-4">
              <div>
                <label className="v-label" htmlFor="disable-code">Código actual (6 dígitos)</label>
                <input
                  id="disable-code"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="\d{6}"
                  value={disableCode}
                  onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="v-input"
                  placeholder="••••••"
                  required
                />
              </div>
              <button type="submit" className="v-btn-ghost" disabled={busy || disableCode.length < 6}>
                {busy ? 'Desactivando...' : 'Desactivar 2FA'}
              </button>
            </form>
          </div>
        )}

        {/* State B — not enabled, no setup running */}
        {!flags.totp_enabled && !setup && (
          <div className="v-card">
            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] tracking-[.22em] uppercase text-[var(--v-accent)] mb-4">2FA NO CONFIGURADO</p>
            <p className="font-['Montserrat',sans-serif] text-[11px] text-[var(--v-text-secondary)] leading-relaxed mb-8">
              Activá 2FA para que el acceso a /admin requiera, además de tu contraseña, un código generado por una app autenticadora (Google Authenticator, Authy, 1Password, Bitwarden, Aegis, etc).
            </p>
            <button onClick={startSetup} className="v-btn-primary" disabled={busy}>
              {busy ? 'Generando...' : 'Activar 2FA'}
            </button>
          </div>
        )}

        {/* State C — setup in progress (QR + recovery + verify) */}
        {setup && (
          <div className="v-card">
            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] tracking-[.22em] uppercase text-[var(--v-accent)] mb-6">PASO 1 · ESCANEÁ EL QR</p>
            <div className="flex flex-col items-center gap-4 mb-8">
              <div className="bg-white p-3 rounded-[6px]">
                <Image src={setup.qrDataUrl} alt="QR de configuración 2FA" width={240} height={240} unoptimized />
              </div>
              <p className="font-['Montserrat',sans-serif] text-[10px] text-[var(--v-text-tertiary)] text-center leading-relaxed max-w-[400px]">
                ¿No podés escanear? Pegá esta clave manualmente en la app:<br/>
                <code className="text-[var(--v-accent)] tracking-[.18em] mt-2 inline-block break-all">
                  {setup.otpauthUri.match(/secret=([A-Z2-7]+)/i)?.[1] ?? ''}
                </code>
              </p>
            </div>

            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] tracking-[.22em] uppercase text-[var(--v-accent)] mb-4">PASO 2 · GUARDÁ LOS CÓDIGOS DE RECUPERACIÓN</p>
            <p className="font-['Montserrat',sans-serif] text-[11px] text-[var(--v-text-secondary)] leading-relaxed mb-4">
              Si perdés acceso al autenticador, podés usar uno de estos códigos para entrar (cada código es de un solo uso). Guardalos en tu password manager <strong>ahora</strong> — no se vuelven a mostrar.
            </p>
            <div className="bg-[var(--v-bg-base)] border border-[rgba(37,99,235,0.15)] rounded-[6px] p-4 mb-3 grid grid-cols-2 gap-2">
              {setup.recoveryCodes.map(code => (
                <code key={code} className="font-mono text-[12px] text-[var(--v-text-primary)] tracking-[.1em]">{code}</code>
              ))}
            </div>
            <label className="flex items-center gap-3 mb-8 cursor-pointer">
              <input
                type="checkbox"
                checked={recoverySaved}
                onChange={e => setRecoverySaved(e.target.checked)}
                className="w-4 h-4 cursor-pointer accent-[var(--v-accent)]"
              />
              <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] text-[var(--v-text-secondary)]">
                Guardé los códigos de recuperación
              </span>
            </label>

            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] tracking-[.22em] uppercase text-[var(--v-accent)] mb-4">PASO 3 · VERIFICÁ</p>
            <form onSubmit={confirmEnable} className="flex flex-col gap-4">
              <div>
                <label className="v-label" htmlFor="enable-code">Código del autenticador (6 dígitos)</label>
                <input
                  id="enable-code"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="\d{6}"
                  value={enableCode}
                  onChange={e => setEnableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="v-input"
                  placeholder="••••••"
                  required
                />
              </div>
              <button type="submit" className="v-btn-primary" disabled={busy || !recoverySaved || enableCode.length < 6}>
                {busy ? 'Activando...' : 'Activar 2FA'}
              </button>
              <button
                type="button"
                onClick={() => { setSetup(null); setEnableCode(''); setRecoverySaved(false) }}
                className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] tracking-[.18em] uppercase text-[var(--v-text-tertiary)] hover:text-[var(--v-text-secondary)] bg-transparent border-none cursor-pointer underline underline-offset-2"
              >
                Cancelar setup
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
