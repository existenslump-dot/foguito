'use client'
// The submit calls /api/me-quiero-publicar directly and doesn't need auth.
// Supabase is imported only for the best-effort profile pre-fill when a
// logged-in user arrives via /publicar?tipo=renovacion (fail-open on error).
import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import EliteQuota from '@/components/EliteQuota'
import { COUNTRY_LABEL, DIAL_CODE, MARKET_FLAG } from '@/config/marketplace.config'
import EliteBenefit from '@/components/EliteBenefit'
import { fetchTierSettings, toActiveSet, DEFAULT_ACTIVE_TIER_SLUGS } from '@/lib/tier-settings'
import { supabase } from '@/lib/supabase/client'
import { whatsappUrl, whatsappRenewalMessage, whatsappSupportMessage, telegramUrl, CONCIERGE_EMAIL } from '@/lib/concierge'
import CountryCodePicker from '@/components/CountryCodePicker'
import { DEFAULT_COUNTRY, findByDial, type CountryCode } from '@/lib/country-codes'

const Turnstile = dynamic(
  () => import('@marsidev/react-turnstile').then(m => m.Turnstile),
  { ssr: false }
)

const ACCENT = 'var(--v-accent-strong)'
const WHITE = 'var(--v-text-primary)'
const BG = 'var(--v-bg-elevated)'
const font = "'Switzer','Inter','Helvetica Neue',Arial,sans-serif"

const TIERS = [
  { id: 'elite',    label: 'Elite',    price: 599 },
  { id: 'gold',   label: 'Gold',   price: 399 },
  { id: 'silver',   label: 'Silver',   price: 199 },
  { id: 'bronze',   label: 'Bronze',   price: 99  },
  { id: 'basic', label: 'Basic', price: 49  },
]

// Per-tier benefits — mirror the /planes comparison table so the user can see
// what's included before committing. Order: most → least basic.
type TierKey = 'elite' | 'gold' | 'silver' | 'bronze' | 'basic'
const TIER_FEATURES: Record<TierKey, { label: string; value: string }[]> = {
  elite: [
    { label: 'Fotos por publicación', value: '18' },
    { label: 'Videos por publicación', value: '3' },
    { label: 'Audios por publicación', value: '1' },
    { label: 'Video de portada', value: 'Sí' },
    { label: 'Historias', value: 'Sí' },
    { label: 'Edita tus fotos', value: 'Sí' },
    { label: 'Edita tu publicación', value: 'Sí' },
    { label: 'Pausas sin costo', value: 'Sí' },
    { label: 'Verificación de identidad', value: 'Sí' },
    { label: 'Top 8 home (prioridad máxima)', value: 'Sí' },
    { label: 'Halo + shimmer', value: 'Sí' },
    { label: 'Cupos por mes', value: '8' },
    { label: 'Soporte', value: '24/7' },
  ],
  gold: [
    { label: 'Fotos por publicación', value: '15' },
    { label: 'Videos por publicación', value: '2' },
    { label: 'Audios por publicación', value: '1' },
    { label: 'Video de portada', value: 'Sí' },
    { label: 'Historias', value: 'Sí' },
    { label: 'Edita tus fotos', value: 'Sí' },
    { label: 'Edita tu publicación', value: 'Sí' },
    { label: 'Pausas sin costo', value: 'Sí' },
    { label: 'Verificación de identidad', value: 'Sí' },
    { label: 'Soporte', value: 'Dedicado' },
  ],
  silver: [
    { label: 'Fotos por publicación', value: '12' },
    { label: 'Videos por publicación', value: '1' },
    { label: 'Audios por publicación', value: '—' },
    { label: 'Video de portada', value: '—' },
    { label: 'Historias', value: 'Sí' },
    { label: 'Edita tus fotos', value: 'Sí' },
    { label: 'Edita tu publicación', value: 'Sí' },
    { label: 'Pausas sin costo', value: 'Sí' },
    { label: 'Verificación de identidad', value: 'Sí' },
    { label: 'Soporte', value: 'Prioritario' },
  ],
  bronze: [
    { label: 'Fotos por publicación', value: '9' },
    { label: 'Videos por publicación', value: '—' },
    { label: 'Audios por publicación', value: '—' },
    { label: 'Video de portada', value: '—' },
    { label: 'Historias', value: 'Sí' },
    { label: 'Edita tus fotos', value: 'Sí' },
    { label: 'Edita tu publicación', value: 'Sí' },
    { label: 'Pausas sin costo', value: '—' },
    { label: 'Verificación de identidad', value: 'Sí' },
    { label: 'Soporte', value: 'Estándar' },
  ],
  basic: [
    { label: 'Fotos por publicación', value: '6' },
    { label: 'Videos por publicación', value: '—' },
    { label: 'Audios por publicación', value: '—' },
    { label: 'Video de portada', value: '—' },
    { label: 'Historias', value: '—' },
    { label: 'Edita tus fotos', value: 'Sí' },
    { label: 'Edita tu publicación', value: 'Sí' },
    { label: 'Pausas sin costo', value: '—' },
    { label: 'Verificación de identidad', value: 'Sí' },
    { label: 'Soporte', value: 'Estándar' },
  ],
}

// Countries — country selector (single default-market entry), all config-driven:
// label = COUNTRY_LABEL, flag = MARKET_FLAG (empty → no flag rendered), dial = DIAL_CODE.
const COUNTRIES = [
  { id: 'default', label: COUNTRY_LABEL, flag: MARKET_FLAG, dial: DIAL_CODE },
]

type PaymentMethod = 'mercadopago' | 'crypto' | 'deposito' | 'transferencia'

function MeQuieroPublicarForm() {
  // Renewal-flow query params — dashboard Renovar CTA lands users here
  // with tipo=renovacion + post_id (+ optional tier). A banner at the top
  // confirms the context and tier auto-selects to match the existing
  // subscription. Validated with a whitelist so garbage in the URL can't
  // poison the pre-fill.
  const searchParams = useSearchParams()
  const tipo = searchParams.get('tipo')
  const isRenewal = tipo === 'renovacion'
  const renewalPostId = isRenewal ? searchParams.get('post_id') : null
  const tierParam = searchParams.get('tier')
  const KNOWN_TIERS = ['elite', 'gold', 'silver', 'bronze', 'basic'] as const
  const initialTier: typeof KNOWN_TIERS[number] = tierParam && (KNOWN_TIERS as readonly string[]).includes(tierParam)
    ? tierParam as typeof KNOWN_TIERS[number]
    : 'elite'

  const [nombre,       setNombre]       = useState('')
  const [pais,         setPais]         = useState('ar')
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(DEFAULT_COUNTRY)
  const [phone,        setPhone]        = useState('')
  const [email,        setEmail]        = useState('')
  const [tier,         setTier]         = useState<string>(initialTier)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mercadopago')
  const [notes,        setNotes]        = useState(
    isRenewal
      ? `Renovación de publicación${renewalPostId ? ` (ref: ${renewalPostId.slice(0, 8)})` : ''}.`
      : '',
  )
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [status,       setStatus]       = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const captchaRef = useRef<HCaptcha>(null)

  // Best-effort pre-fill when a logged-in user arrives from the dashboard
  // Renovar CTA. We read the profile once; failures are silent (the user
  // types their data instead). Not blocking the render — fields stay
  // empty-and-typeable until the async lookup resolves.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, email, phone')
          .eq('id', user.id)
          .maybeSingle()
        if (cancelled || !profile) return
        if (profile.full_name) setNombre(prev => prev || profile.full_name!)
        if (profile.email) setEmail(prev => prev || profile.email!)
        if (profile.phone) {
          // Phone arrives as "+54 9 11 1234 5678" — split into dial code + rest.
          const trimmed = profile.phone.trim()
          const match = trimmed.match(/^(\+\d{1,3})\s*(.*)$/)
          if (match) {
            const found = findByDial(match[1])
            if (found) setSelectedCountry(prev => (prev === DEFAULT_COUNTRY ? found : prev))
            setPhone(prev => prev || match[2])
          } else {
            setPhone(prev => prev || trimmed)
          }
        }
      } catch (err) {
        console.error('[publicar] profile pre-fill failed', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Launch-gate — which tiers the user can request; admin flips them on
  // from /admin.
  const [activeTierSlugs, setActiveTierSlugs] = useState<Set<string>>(
    new Set(DEFAULT_ACTIVE_TIER_SLUGS),
  )
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const rows = await fetchTierSettings()
      if (!cancelled) setActiveTierSlugs(toActiveSet(rows))
    })()
    return () => { cancelled = true }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nombre.trim() || !pais || !phone.trim() || !email.trim() || !tier) {
      setStatus({ text: 'Completá todos los campos requeridos.', type: 'error' })
      return
    }
    if (!captchaToken) {
      setStatus({ text: 'Completá el captcha.', type: 'error' })
      return
    }
    setLoading(true); setStatus(null)
    try {
      const tierObj = TIERS.find(t => t.id === tier)
      const paisObj = COUNTRIES.find(c => c.id === pais)
      const paymentLabel =
        paymentMethod === 'mercadopago'   ? 'Mercado Pago'
        : paymentMethod === 'crypto'       ? 'Cripto (USDT)'
        : paymentMethod === 'deposito'     ? 'Depósito bancario'
        : 'Transferencia'
      const payload = {
        nombre,
        ciudad: paisObj?.label || pais, // API still expects `ciudad` field — pass country label
        whatsapp: `${selectedCountry.dial} ${phone}`,
        correo: email,
        tier: `${tierObj?.label} — ${tierObj?.price} USD/mes`,
        metodo_pago: paymentLabel,
        notas: notes,
        captcha_token: captchaToken,
      }
      const res = await fetch('/api/me-quiero-publicar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setStatus({ text: 'Solicitud enviada. Te contactaremos por correo.', type: 'success' })
        setNombre(''); setPhone(''); setEmail(''); setNotes('')
        setCaptchaToken(null)
      } else {
        setStatus({ text: data.error || 'Error al enviar la solicitud.', type: 'error' })
      }
    } catch {
      setStatus({ text: 'Error de conexión. Intentá de nuevo.', type: 'error' })
    }
    setLoading(false)
  }

  return (
    <>
      <style>{`
        @keyframes mqpFadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }
        .mqp-fade { opacity:0; animation:mqpFadeUp .8s cubic-bezier(.22,1,.36,1) forwards; }
        /* Profesional ode — mobile only, hidden on desktop where the layout
           makes it look out of place. */
        @media (min-width: 768px) { .mqp-profesional-note { display:none !important } }
        /* Shared input styles (was the inputStyle object in the component).
           Applied to every text/email/tel/select/textarea/phone-button so the
           form reads as one consistent system. */
        .mqp-input {
          width:100%; background:${BG};
          border:1px solid rgba(37, 99, 235,0.3);
          padding:14px 16px; border-radius:6px; outline:none;
          font-family:${font}; font-size:15px; font-weight:400;
          color:${WHITE}; transition:border-color .3s ease;
          box-sizing:border-box; height:48px;
        }
        .mqp-input::placeholder { color:var(--v-text-tertiary); }
        .mqp-input:focus { border-color:${ACCENT} !important; }

        /* Field labels — same typography as the Enviar/Escríbenos buttons
           (clamp 13–16px, weight 500, .18em uppercase) so the form reads as a
           coherent system rather than mixing giant serif-style labels with
           uppercase CTAs. */
        .mqp-h-big {
          font-family:${font};
          font-size:clamp(13px, 2.5vw, 16px);
          font-weight:500;
          letter-spacing:.18em;
          text-transform:uppercase;
          color:${ACCENT};display:block;margin-bottom:14px;
        }

        .mqp-sticky-bar {
          position:sticky; top:0; z-index:40;
          background:${BG};
          display:flex; align-items:center; justify-content:center;
          height:64px; padding:0 16px;
          border-bottom:1px solid rgba(37, 99, 235,0.1);
        }

        /* Radio row — matches /pagos .vp-radio */
        .mqp-radio {
          display:flex; align-items:center; gap:10px;
          padding:14px 16px; border-radius:6px;
          border:1px solid rgba(37, 99, 235,0.18); cursor:pointer;
          background:transparent; transition:border-color .25s, background .25s;
          margin-bottom:8px;
        }
        .mqp-radio.selected { border-color:${ACCENT}; background:rgba(37, 99, 235,0.06); }
        .mqp-radio-dot {
          width:10px; height:10px; border-radius:50%;
          border:1px solid var(--v-border); flex-shrink:0;
          transition:background .2s, border-color .2s;
        }
        .mqp-radio.selected .mqp-radio-dot { background:${ACCENT}; border-color:${ACCENT}; }
        .mqp-item-name {
          font-family:${font};
          font-size:14px;font-weight:400;letter-spacing:.02em;color:${WHITE};
          display:flex;align-items:center;gap:8px;
        }
      `}</style>

      <main className="min-h-screen bg-[var(--v-bg-base)] text-[var(--v-text-primary)]">

        {status && (
          <div
            className={`fixed top-6 left-1/2 -translate-x-1/2 z-[500] px-7 py-3 rounded-[6px] border font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-xs font-normal tracking-[.22em] uppercase backdrop-blur-md max-w-[90vw] text-center ${
              status.type === 'error'
                ? 'border-[rgba(224,85,85,0.25)] bg-[rgba(224,85,85,0.06)] text-[var(--v-error)]'
                : 'border-[rgba(37,99,235,0.25)] bg-[rgba(37,99,235,0.06)] text-[var(--v-accent)]'
            }`}
          >
            {status.text}
          </div>
        )}

        <div className="max-w-[640px] mx-auto px-8 pt-12 pb-20">

          <div className="mqp-fade mb-12 text-center" style={{ animationDelay: '.05s' }}>
            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal tracking-[0.2em] uppercase text-[var(--v-accent-strong)] mb-3.5">
              {isRenewal ? 'Renovación' : 'Solicitud'}
            </p>
            <h1 className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[clamp(28px,4vw,36px)] font-normal text-[var(--v-text-primary)] leading-[1.1] mb-5">
              {isRenewal ? 'Renovar mi publicación' : 'Me quiero publicar'}
            </h1>
            <div className="w-10 h-px mx-auto bg-[linear-gradient(90deg,transparent,var(--v-accent),transparent)]" />
            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[13px] font-normal text-[var(--v-text-secondary)] mt-6 leading-[1.6]">
              {isRenewal
                ? 'Confirmá tus datos y método de pago. Nuestro equipo procesa la renovación en menos de 24 h.'
                : 'Completá el formulario y nuestro equipo te contactará para gestionar tu publicación de forma personalizada'}
            </p>
          </div>

          {isRenewal && whatsappUrl() && (
            <div className="mqp-fade mb-8 rounded-[6px] border border-[rgba(37,99,235,0.25)] bg-[rgba(37,99,235,0.04)] px-5 py-4" style={{ animationDelay: '.08s' }}>
              <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal tracking-[.22em] uppercase text-[var(--v-accent-strong)] mb-2">
                ¿Preferís WhatsApp?
              </p>
              <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal leading-[1.6] text-[var(--v-text-secondary)] mb-3">
                Escribinos directo y gestionamos tu renovación en el chat, sin pasar por el formulario.
              </p>
              <a
                href={whatsappUrl(whatsappRenewalMessage({ postId: renewalPostId }))}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[var(--v-accent)] hover:bg-[var(--v-accent-light)] text-[#FFFFFF] px-5 py-2.5 rounded-[6px] no-underline font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-medium tracking-[.18em] uppercase transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#FFFFFF" className="shrink-0">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                <span>Continuar por WhatsApp</span>
              </a>
              <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal text-[var(--v-text-tertiary)] mt-3">
                O continuá con el formulario. También podés escribirnos a{' '}
                <a href={`mailto:${CONCIERGE_EMAIL}`} className="text-[var(--v-accent-strong)] underline">{CONCIERGE_EMAIL}</a>.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mqp-fade flex flex-col gap-7" style={{ animationDelay: '.15s' }}>

            <div>
              <label className="mqp-h-big">Nombre</label>
              <input type="text" placeholder="Cómo querés que te llamen" className="mqp-input"
                value={nombre} onChange={e => setNombre(e.target.value)} required />
            </div>

            <div>
              <label className="mqp-h-big">País</label>
              <div>
                {COUNTRIES.map(c => (
                  <div
                    key={c.id}
                    className={`mqp-radio${pais === c.id ? ' selected' : ''}`}
                    onClick={() => {
                      setPais(c.id)
                      const match = findByDial(c.dial)
                      if (match) setSelectedCountry(match)
                    }}
                  >
                    <span className="mqp-radio-dot" />
                    <span className="mqp-item-name">
                      {c.flag && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.flag} alt={c.label} className="w-5 h-[14px] object-cover rounded-[6px] shrink-0" />
                      )}
                      {c.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="mqp-h-big">WhatsApp</label>
              <div className="flex gap-2 items-stretch">
                <div className="w-[128px] flex-shrink-0">
                  <CountryCodePicker
                    value={selectedCountry}
                    onChange={setSelectedCountry}
                    className="mqp-input w-full flex items-center gap-2 cursor-pointer text-left !px-3"
                  />
                </div>
                <input
                  type="tel" placeholder="9 1234 5678" className="mqp-input flex-1"
                  value={phone}
                  maxLength={selectedCountry.maxDigits ?? 15}
                  onChange={e => {
                    const max = selectedCountry.maxDigits ?? 15
                    setPhone(e.target.value.replace(/\D/g, '').slice(0, max))
                  }}
                  required
                />
              </div>
            </div>

            <div>
              <label className="mqp-h-big">Correo electrónico</label>
              <input type="email" placeholder="tu@email.com" className="mqp-input"
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>

            <div>
              <label className="mqp-h-big">Nivel deseado</label>
              <div className="h-px bg-[rgba(37,99,235,0.12)]" />
              {TIERS.filter(t => activeTierSlugs.has(t.id)).map(t => {
                const isSelected = tier === t.id
                const tierName = t.label.toUpperCase()
                const features = TIER_FEATURES[t.id as TierKey]
                const isElite = t.id === 'elite'
                return (
                  <div key={t.id}>
                    <div
                      onClick={() => setTier(t.id)}
                      className={`flex items-center justify-between py-[22px] cursor-pointer transition-opacity ${isSelected ? 'opacity-100' : 'opacity-[.78] border-b border-[rgba(37,99,235,0.12)]'}`}
                    >
                      <span className="inline-flex items-baseline gap-2.5 flex-wrap">
                        <span
                          className={`font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-sm tracking-[.22em] uppercase ${
                            isElite
                              ? 'font-semibold text-[var(--v-accent-strong)] [text-shadow:0_0_12px_rgba(37,99,235,0.4)]'
                              : `font-normal ${isSelected ? 'text-[var(--v-accent-strong)]' : 'text-[var(--v-text-primary)]'}`
                          }`}
                        >
                          {tierName}
                        </span>
                        {isElite && (
                          <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[8px] font-medium tracking-[.22em] uppercase text-[#FFFFFF] bg-[linear-gradient(135deg,#93C5FD,var(--v-accent))] px-[7px] py-0.5 rounded-[6px]">
                            Top
                          </span>
                        )}
                      </span>
                      <span>
                        <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[26px] font-medium tracking-[-.01em] text-[var(--v-accent-strong)] [font-variant-numeric:tabular-nums]">
                          {t.price}
                        </span>
                        <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal tracking-[.16em] text-[var(--v-accent-strong)] ml-1.5">USD/mes</span>
                      </span>
                    </div>
                    {isElite && isSelected && (
                      <div className="mb-3.5">
                        <EliteQuota variant="banner" copy="detailed" />
                      </div>
                    )}

                    {isSelected && t.id === 'basic' && (
                      <p className="mqp-profesional-note mt-1 mb-3.5 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal tracking-[.04em] leading-[1.7] italic text-[var(--v-text-tertiary)]">
                        No nos olvidamos de ti, profesional ✨
                      </p>
                    )}

                    {isSelected && features && (
                      <div
                        className="bg-[rgba(37,99,235,0.04)] border border-[rgba(37,99,235,0.15)] rounded-[6px] px-[18px] py-4 mb-[18px]"
                        style={{ animation: 'mqpFadeUp .35s cubic-bezier(.22,1,.36,1) both' }}
                      >
                        {features.map((f, fi) => (
                          <div
                            key={f.label}
                            className={`flex justify-between items-center py-2 ${fi < features.length - 1 ? 'border-b border-[rgba(37,99,235,0.08)]' : ''}`}
                          >
                            <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[13px] font-normal text-[var(--v-text-primary)]">
                              {f.label}
                            </span>
                            <span
                              className={`font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[13px] ${f.value === '24/7' ? 'font-medium' : 'font-normal'} ${
                                f.value === '—'
                                  ? 'text-[var(--v-text-tertiary)]'
                                  : (f.value === '24/7' || f.value === 'Sí')
                                    ? 'text-[var(--v-accent-strong)]'
                                    : 'text-[var(--v-text-primary)]'
                              }`}
                            >
                              {f.value === 'Sí' ? '✦' : f.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              <p className="mt-5 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-xs font-normal tracking-[.02em] leading-[1.7] text-[var(--v-text-secondary)]">
                Publicada en <strong className="text-[var(--v-accent-strong)] font-semibold">menos de 24 h</strong>. Pago en USD via MercadoPago o criptomoneda. Soporte directo por WhatsApp
              </p>
              <EliteBenefit marginTop={24} />
            </div>

            <div>
              <label className="mqp-h-big">Forma de pago</label>
              <select
                className="mqp-input"
                value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}
              >
                <option value="mercadopago">Mercado Pago</option>
                <option value="crypto">Cripto (USDT)</option>
                <option value="deposito">Depósito bancario</option>
                <option value="transferencia">Transferencia</option>
              </select>
            </div>

            <div>
              <label className="mqp-h-big">Mensaje (opcional)</label>
              <textarea
                placeholder="Cualquier información adicional que quieras compartir…"
                className="mqp-input !h-auto min-h-[120px] resize-y leading-[1.7]"
                value={notes} onChange={e => setNotes(e.target.value)}
              />
            </div>

            <div className="pt-2 flex flex-col gap-4 items-center">
              {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? (
                <Turnstile
                  siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                  onSuccess={(token: string) => setCaptchaToken(token)}
                  onExpire={() => setCaptchaToken(null)}
                  options={{ theme: 'dark', size: 'flexible' }}
                />
              ) : process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY ? (
                <HCaptcha
                  ref={captchaRef}
                  sitekey={process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY}
                  onVerify={(token) => setCaptchaToken(token)}
                  onExpire={() => setCaptchaToken(null)}
                  theme="dark"
                />
              ) : null}

              <button
                type="submit" disabled={loading}
                className={`w-full p-[18px] border-none rounded-[6px] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[clamp(13px,2.5vw,16px)] font-medium tracking-[.18em] uppercase transition-colors whitespace-nowrap ${
                  loading
                    ? 'bg-[rgba(37,99,235,0.08)] text-[var(--v-text-tertiary)] cursor-not-allowed'
                    : 'bg-[var(--v-accent)] text-[#FFFFFF] cursor-pointer'
                }`}
              >
                {loading ? 'Enviando…' : 'Enviar'}
              </button>

              <div className="w-full h-px my-1 bg-[linear-gradient(90deg,transparent,rgba(37,99,235,0.35),transparent)]" />

              {whatsappUrl() && (
                <a
                  href={whatsappUrl(
                    isRenewal
                      ? whatsappRenewalMessage({ postId: renewalPostId })
                      : whatsappSupportMessage(),
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2.5 w-full bg-[var(--v-accent)] hover:bg-[var(--v-accent-light)] text-[var(--v-bg-base)] p-[18px] rounded-[6px] border-none cursor-pointer no-underline font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[clamp(13px,2.5vw,16px)] font-medium tracking-[.18em] uppercase transition-colors whitespace-nowrap"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--v-bg-base)" className="shrink-0">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  <span>Escríbenos</span>
                </a>
              )}

              {/* Telegram fallback, env-gated on NEXT_PUBLIC_CONCIERGE_TELEGRAM.
                  t.me deep-links don't support pre-fill text natively, so we
                  drop the message arg and just open the chat. */}
              {telegramUrl() && (
                <a
                  href={telegramUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2.5 w-full bg-[var(--v-accent)] hover:bg-[var(--v-accent-light)] text-[var(--v-bg-base)] p-[18px] rounded-[6px] border-none cursor-pointer no-underline font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[clamp(13px,2.5vw,16px)] font-medium tracking-[.18em] uppercase transition-colors whitespace-nowrap"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--v-bg-base)" className="shrink-0">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                  </svg>
                  <span>Escríbenos</span>
                </a>
              )}
            </div>
          </form>

        </div>

      </main>
    </>
  )
}

export default function MeQuieroPublicarPage() {
  // Next 16 requires useSearchParams-using components to sit under a
  // Suspense boundary so the static prerender can stream a placeholder
  // while the client resolves the query string. Matches /ingresar and
  // /registro shape.
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--v-bg-base)]" />}>
      <MeQuieroPublicarForm />
    </Suspense>
  )
}
