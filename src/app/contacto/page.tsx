'use client'
import { useRef, useState } from 'react'
import { Turnstile, TurnstileInstance } from '@marsidev/react-turnstile'
import SiteFooter from "@/components/SiteFooter"
import { whatsappUrl, whatsappSupportMessage, telegramUrl } from '@/lib/concierge'

const SITEKEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
const ACCENT = 'var(--v-accent)'
const WHITE = '#FFFFFF'
// Text sitting on the page / field backgrounds. Uses the theme token so it
// stays readable in both modes (near-black #0F172A in light, near-white in
// dark) — the form was previously hardcoded white, which vanished on the
// light/white background.
const TEXT = 'var(--v-text-primary)'
const PAGE_BG = 'var(--v-bg-base)'
const FIELD_BG = 'var(--v-bg-elevated)'
const font = "'Switzer','Inter','Helvetica Neue',Arial,sans-serif"

export default function ContactoPage() {
  const [nombre,  setNombre]  = useState('')
  const [correo,  setCorreo]  = useState('')
  const [asunto,  setAsunto]  = useState('')
  const [mensaje, setMensaje] = useState('')
  const [loading, setLoading] = useState(false)
  const [status,  setStatus]  = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  // Incrementing key force-remounts the Turnstile widget — only reliable
  // way to recover after a consumed/expired token. Same pattern as /ingresar.
  const [captchaKey,   setCaptchaKey]   = useState(0)
  const turnstileRef = useRef<TurnstileInstance>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nombre.trim() || !correo.trim() || !asunto.trim() || !mensaje.trim()) {
      setStatus({ text: 'Por favor completa todos los campos.', type: 'error' })
      return
    }
    if (SITEKEY && !captchaToken) {
      setStatus({ text: 'Completa el captcha.', type: 'error' })
      return
    }
    setLoading(true)
    setStatus(null)

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, correo, asunto, mensaje, captchaToken }),
      })
      const data = await res.json()

      if (res.ok && (data.success || data.ok)) {
        setStatus({ text: 'Tu consulta fue enviada.', type: 'success' })
        setNombre(''); setCorreo(''); setAsunto(''); setMensaje('')
        setCaptchaToken(null)
        setCaptchaKey(k => k + 1)
      } else {
        setStatus({ text: data.error || 'Error al enviar el mensaje.', type: 'error' })
        // Consumed tokens can't be re-used — remount the widget so the
        // user can retry without reloading.
        turnstileRef.current?.reset()
        setCaptchaToken(null)
      }
    } catch {
      setStatus({ text: 'Error de conexión. Intenta nuevamente.', type: 'error' })
    }
    setLoading(false)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: FIELD_BG,
    border: `1px solid rgba(37, 99, 235,0.3)`,
    padding: '14px 16px', borderRadius: '6px', outline: 'none',
    fontFamily: font, fontSize: '15px', fontWeight:400,
    color: TEXT, transition: 'border-color .3s ease', boxSizing: 'border-box',
    height: '48px',
  }

  return (
    <>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }
        .ct-fade { opacity:0; animation:fadeUp .8s cubic-bezier(.22,1,.36,1) forwards; }

        @keyframes lineExpand { from{transform:scaleX(0)} to{transform:scaleX(1)} }
        .ct-line {
          display:block; height:1px;
          background:linear-gradient(90deg,transparent,${ACCENT} 40%,${ACCENT} 60%,transparent);
          transform-origin:left;
          animation:lineExpand 1.2s cubic-bezier(.22,1,.36,1) .2s both;
          transform:scaleX(0);
        }

        .ct-input::placeholder { color:var(--v-text-tertiary); }
        .ct-input:focus { border-color:${ACCENT} !important; }

        .ct-label {
          display:block;
          font-family:${font};font-size:9px;font-weight:400;
          letter-spacing:.22em;text-transform:uppercase;color:${ACCENT};
          margin-bottom:8px;
        }

        @media(max-width:639px) {
          .ct-page-pad { padding:16px 24px 60px !important; }
        }
      `}</style>

      <main style={{ minHeight: '100vh', background: PAGE_BG, color: TEXT }}>

        {/* Toast — viewport-centered (vertical + horizontal). Same pattern
            as the verify toast moved to center in v35 #252. Pointer-events
            none so it never blocks an underlying click while it shows. */}
        {status && (
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 500,
            padding: '12px 28px', borderRadius: '6px',
            border: `1px solid ${status.type === 'error' ? 'rgba(224,85,85,0.25)' : `rgba(37, 99, 235,0.25)`}`,
            background: status.type === 'error' ? 'rgba(224,85,85,0.45)' : 'rgba(37, 99, 235,0.45)',
            fontFamily: font, fontSize: '12px', fontWeight:400,
            letterSpacing: '.22em', textTransform: 'uppercase',
            color: status.type === 'error' ? 'var(--v-error)' : WHITE,
            whiteSpace: 'nowrap', backdropFilter: 'blur(12px)',
            pointerEvents: 'none',
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          }}>
            {status.text}
          </div>
        )}

        <div className="ct-page-pad" style={{ maxWidth: '640px', margin: '0 auto', padding: '48px 32px 80px' }}>

          {/* Page title */}
          <div className="ct-fade" style={{ animationDelay: '.05s', marginBottom: '48px' }}>
            <p style={{
              fontFamily: font, fontSize: '9px', fontWeight:400,
              letterSpacing: '.22em', textTransform: 'uppercase',
              color: ACCENT, marginBottom: '12px',
            }}>
              Contacto
            </p>
            <h1 style={{
              fontFamily: font,
              fontSize: 'clamp(36px, 5vw, 52px)', fontWeight:400,
              color: TEXT, lineHeight: 1, marginBottom: '24px',
            }}>
              Hablemos
            </h1>
            <span className="ct-line" />
          </div>

          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className="ct-fade"
            style={{ display: 'flex', flexDirection: 'column', gap: '24px', animationDelay: '.15s' }}
          >
            <div>
              <label className="ct-label">Nombre</label>
              <input
                type="text"
                placeholder="Tu nombre"
                className="ct-input"
                style={inputStyle}
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="ct-label">Correo Electr&oacute;nico</label>
              <input
                type="email"
                placeholder="tu@email.com"
                className="ct-input"
                style={inputStyle}
                value={correo}
                onChange={e => setCorreo(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="ct-label">Asunto</label>
              <input
                type="text"
                placeholder="Motivo de contacto"
                className="ct-input"
                style={inputStyle}
                value={asunto}
                onChange={e => setAsunto(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="ct-label">Mensaje</label>
              <textarea
                placeholder="Escribe tu mensaje aqu&iacute;..."
                className="ct-input"
                style={{ ...inputStyle, minHeight: '140px', height: 'auto', resize: 'vertical', lineHeight: 1.8 }}
                value={mensaje}
                onChange={e => setMensaje(e.target.value)}
                required
              />
            </div>

            <div style={{ paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
              {SITEKEY && (
                <Turnstile
                  key={captchaKey}
                  ref={turnstileRef}
                  siteKey={SITEKEY}
                  onSuccess={(token) => setCaptchaToken(token)}
                  onExpire={() => { setCaptchaToken(null); turnstileRef.current?.reset() }}
                  onError={() => { setCaptchaToken(null); setCaptchaKey(k => k + 1) }}
                  // refreshExpired=auto regenerates the token near the 5-min
                  // TTL so long-idle forms don't submit with a stale token.
                  options={{ theme: 'dark', size: 'flexible', refreshExpired: 'auto' }}
                />
              )}
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', padding: '16px',
                  background: loading ? 'rgba(255,255,255,0.04)' : ACCENT,
                  color: loading ? 'rgba(255,255,255,0.3)' : 'var(--v-bg-base)',
                  border: 'none', borderRadius: '6px',
                  fontFamily: font, fontSize: '11px', fontWeight:500,
                  letterSpacing: '.18em', textTransform: 'uppercase',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'background .3s ease',
                }}
              >
                {loading ? 'Enviando...' : 'Enviar mensaje'}
              </button>
            </div>
          </form>

          {/* Direct contact channels — WhatsApp + Telegram. Both env-gated
              so an unconfigured channel disappears cleanly. Styled to
              match the form's submit (accent fill, p16, fontSize 11, .18em
              tracking) so the visual hierarchy stays consistent. The form
              is still the primary CTA — these are the "or write us direct"
              alternatives, separated by a hairline divider. */}
          {(whatsappUrl() || telegramUrl()) && (
            <div
              className="ct-fade"
              style={{
                marginTop: '48px',
                display: 'flex', flexDirection: 'column', gap: '16px',
                animationDelay: '.25s',
              }}
            >
              <div
                style={{
                  height: '1px',
                  background: 'linear-gradient(90deg,transparent,rgba(37, 99, 235,0.35),transparent)',
                  marginBottom: '8px',
                }}
              />
              <p
                style={{
                  textAlign: 'center',
                  fontFamily: font, fontSize: '9px', fontWeight: 400,
                  letterSpacing: '.22em', textTransform: 'uppercase',
                  color: ACCENT, marginBottom: '4px',
                }}
              >
                O escribinos directo
              </p>

              {whatsappUrl() && (
                <a
                  href={whatsappUrl(whatsappSupportMessage())}
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v-accent-light)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ACCENT }}
                  style={{
                    width: '100%', padding: '16px',
                    background: ACCENT, color: 'var(--v-bg-base)',
                    border: 'none', borderRadius: '6px',
                    fontFamily: font, fontSize: '11px', fontWeight: 500,
                    letterSpacing: '.18em', textTransform: 'uppercase',
                    cursor: 'pointer', textDecoration: 'none',
                    transition: 'background .3s ease',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: '10px', boxSizing: 'border-box',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--v-bg-base)" style={{ flexShrink: 0 }}>
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  <span>Escribinos</span>
                </a>
              )}

              {telegramUrl() && (
                <a
                  href={telegramUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v-accent-light)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ACCENT }}
                  style={{
                    width: '100%', padding: '16px',
                    background: ACCENT, color: 'var(--v-bg-base)',
                    border: 'none', borderRadius: '6px',
                    fontFamily: font, fontSize: '11px', fontWeight: 500,
                    letterSpacing: '.18em', textTransform: 'uppercase',
                    cursor: 'pointer', textDecoration: 'none',
                    transition: 'background .3s ease',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: '10px', boxSizing: 'border-box',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--v-bg-base)" style={{ flexShrink: 0 }}>
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                  </svg>
                  <span>Escribinos</span>
                </a>
              )}
            </div>
          )}

        </div>

        <SiteFooter />
      </main>
    </>
  )
}
