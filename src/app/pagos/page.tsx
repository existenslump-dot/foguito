'use client'
import { supabase } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import MercadoPagoBricks from '@/components/pagos/MercadoPagoBricks'
import EliteQuota from '@/components/EliteQuota'
import EliteBenefit from '@/components/EliteBenefit'
import { fetchTierSettings, toActiveSet, DEFAULT_ACTIVE_TIER_SLUGS } from '@/lib/tier-settings'
import { PAYMENTS_DISABLED } from '@/lib/maintenance'
import PaymentsMaintenanceBanner from '@/components/PaymentsMaintenanceBanner'
import { PUBLIC_PACKAGE_LIST, PUBLIC_DURATIONS, packageTierSlug } from '@/lib/packages'
import { MARKETPLACE } from '@/config/marketplace.config'
import { CONCIERGE_EMAIL, whatsappUrl, whatsappSupportMessage } from '@/lib/concierge'
import { getUserId } from '@/lib/supabase/direct'

// `credits` field kept for backwards compatibility with the MP webhook payload.
// Per-tier benefits mirror the /planes comparison table; keep in sync with
// /publicar's TIER_FEATURES.
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
    { label: 'Primeras 8 (prioridad máxima)', value: 'Sí' },
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

// Server-authoritative tier catalogue (public tiers only). Prices come from
// MARKETPLACE.billing via @/lib/packages — never hardcode them here.
const CREDIT_PACKAGES = PUBLIC_PACKAGE_LIST

const CRYPTO_CURRENCIES = [
  { id: 'usdttrc20', label: 'USDT', network: 'TRC20', icon: '₮' },
  { id: 'btc',       label: 'BTC',  network: 'Bitcoin', icon: '₿' },
  { id: 'eth',       label: 'ETH',  network: 'Ethereum', icon: 'Ξ' },
]

// Country presentation registry, keyed by ISO-3166 alpha-2 (matches
// MARKETPLACE.market.allowedCountries). The selector below is driven by the
// configured countries only — adding a market is a config edit, not code
// surgery. `localMethodLabel` names the local rail shown in the method picker.
type LocalRail = 'mercadopago' | 'pix'
type CountryMeta = {
  id: string
  label: string
  flag: string
  currency: string
  symbol: string
  localMethodLabel: string
  /**
   * Which local payment rail is live for this country, or null (crypto-only).
   * Drives the method menu so it's data-driven instead of a hardcoded country.
   * NOTE: a rail assumes the deployment's market currency matches the country —
   * the server routes gate on it (e.g. PIX requires MARKET_CURRENCY=BRL).
   */
  localRail: LocalRail | null
  /** countries slugs as stored in the `countries` table (geo activation). */
  countryNames: string[]
}
const COUNTRY_REGISTRY: Record<string, CountryMeta> = {
  AR: { id: 'ar', label: 'Argentina', flag: '/images/argentina.png', currency: 'ARS', symbol: '$',  localMethodLabel: 'Transferencia',  localRail: 'mercadopago', countryNames: ['argentina'] },
  CL: { id: 'cl', label: 'Chile',     flag: '/images/chile.png',     currency: 'CLP', symbol: '$',  localMethodLabel: 'Pago local',     localRail: null,          countryNames: ['chile'] },
  BR: { id: 'br', label: 'Brasil',    flag: '/images/brasil.png',    currency: 'BRL', symbol: 'R$', localMethodLabel: 'Pix / Boleto',   localRail: 'pix',          countryNames: ['brasil', 'brazil'] },
}
const COUNTRIES: CountryMeta[] = MARKETPLACE.market.allowedCountries
  .map(code => COUNTRY_REGISTRY[code.toUpperCase()])
  .filter((c): c is CountryMeta => Boolean(c))
// Single-country deployments skip the country step entirely.
const SHOW_COUNTRY_STEP = COUNTRIES.length > 1
const LOCAL_CURRENCY = MARKETPLACE.market.currency

/** Shape returned by /api/pagos/mp/pix (instant QR payment). */
type PixResult = {
  qr_code: string | null
  qr_code_base64: string | null
  ticket_url: string | null
  expires_at: string | null
}

// Anonymous checkout is gated behind BOTH the server env (PAYMENTS_ALLOW_ANONYMOUS)
// and the public mirror used here for the client-side login-first gate.
const ALLOW_ANONYMOUS = process.env.NEXT_PUBLIC_PAYMENTS_ALLOW_ANONYMOUS === 'true'

const SUPPORT_EMAIL = MARKETPLACE.integrations.concierge.email || CONCIERGE_EMAIL
const SUPPORT_WHATSAPP_URL = whatsappUrl(whatsappSupportMessage())

type PayResult = {
  payment_id:   string | number
  pay_address:  string
  pay_amount:   number
  pay_currency: string
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.round(diffMs / 60000)
  if (min < 1) return 'hace unos segundos'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} d`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className={`font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[7px] font-normal tracking-[.18em] uppercase bg-transparent border rounded-[6px] px-3 py-[5px] cursor-pointer transition-all shrink-0 ${
        copied
          ? 'text-[var(--v-success)] border-[rgba(100,180,100,0.3)]'
          : 'text-[var(--v-accent)] border-[rgba(37,99,235,0.3)]'
      }`}
    >
      {copied ? '✓ Copiado' : 'Copiar'}
    </button>
  )
}

function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    if (left <= 0) return
    const id = setInterval(() => setLeft(s => s - 1), 1000)
    return () => clearInterval(id)
  }, [left])
  const m = Math.floor(left / 60).toString().padStart(2, '0')
  const s = (left % 60).toString().padStart(2, '0')
  const pct = (left / seconds) * 100
  const color = left < 120 ? 'var(--v-error)' : left < 300 ? 'var(--v-accent)' : 'var(--v-success)'
  return (
    <div className="text-center">
      <div
        className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[28px] font-normal mb-2 [font-variant-numeric:tabular-nums]"
        style={{ color }}
      >{m}:{s}</div>
      <div className="h-0.5 bg-[rgba(37,99,235,0.1)] rounded-[6px] overflow-hidden">
        <div
          className="h-full transition-[width,background] duration-1000"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[7px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] mt-1.5">
        {left <= 0 ? 'Expirado' : 'Tiempo restante'}
      </p>
    </div>
  )
}

export default function PagosPage() {
  // Early-return before any hook so the bricks SDK + state machinery never
  // mount when payments are disabled. Flip PAYMENTS_DISABLED in @/lib/maintenance.
  if (PAYMENTS_DISABLED) return <PaymentsMaintenanceBanner />

  const [accessToken] = useState<string | null>(null)

  const [payerEmail, setPayerEmail] = useState<string>('')

  // Default to tier_plus (second tier). We avoid defaulting to Elite because
  // its auto-trigger hides the MP Bricks flow and leaves the "Transferencia"
  // button looking broken on first paint.
  const [selectedPkg,     setSelectedPkg]     = useState<string>('tier_plus')
  // Subscription length filter (30 = monthly, 15 = quincena). Only surfaces
  // as a toggle when the catalogue actually offers more than one duration —
  // a deployment that trims its catalogue to monthly-only sees no toggle.
  const [selectedDuration, setSelectedDuration] = useState<number>(
    PUBLIC_DURATIONS.includes(30) ? 30 : (PUBLIC_DURATIONS[0] ?? 30),
  )
  const [selectedCountry, setSelectedCountry] = useState<string>(COUNTRIES[0]?.id ?? 'ar')
  const [payMethod,       setPayMethod]       = useState<'local' | 'crypto'>('local')
  const [cryptoCurrency,  setCryptoCurrency]  = useState<string>('usdttrc20')
  const [pixResult,       setPixResult]       = useState<PixResult | null>(null)

  // Login-first checkout: detect a Supabase session lock-free (see
  // @/lib/supabase/direct rationale). `null` = unknown (still checking),
  // so we don't flash the login wall before the cookie read settles.
  const [hasSession, setHasSession] = useState<boolean | null>(null)
  useEffect(() => {
    setHasSession(Boolean(getUserId()))
  }, [])

  // Launch-gate for which packages are publicly offered (see tier_settings
  // table + /admin toggle). Package ids are 'tier_<slug>' — we unwrap to
  // match against the active-slug set.
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

  // If the selected package's tier got deactivated (admin toggle) or fell out
  // of the visible duration, fall back to the first active non-Elite package
  // so the list always shows a selectable row — otherwise nothing appears
  // selected and the summary charges a tier the user can't see. Elite is
  // last resort (forces crypto).
  useEffect(() => {
    const activePkgs = CREDIT_PACKAGES.filter(p =>
      p.duration_days === selectedDuration && activeTierSlugs.has(packageTierSlug(p.id) ?? ''))
    if (activePkgs.length === 0 || activePkgs.some(p => p.id === selectedPkg)) return
    const fallback = activePkgs.find(p => packageTierSlug(p.id) !== 'elite') ?? activePkgs[0]
    setSelectedPkg(fallback.id)
  }, [activeTierSlugs, selectedPkg, selectedDuration])

  // Switch duration keeping the same tier selected (Bronze monthly → Bronze
  // 15 days), so toggling never silently changes what the summary charges.
  const pickDuration = (days: number) => {
    setSelectedDuration(days)
    const slug = packageTierSlug(selectedPkg)
    const match = CREDIT_PACKAGES.find(
      p => p.duration_days === days && packageTierSlug(p.id) === slug,
    )
    if (match) setSelectedPkg(match.id)
  }

  // Elite mode: ANY time the user is on an Elite package — either duration,
  // whether they arrived via ?plan=elite or picked it from the selector.
  // Tier Elite has a different backend flow — hosted NOWPayments invoice
  // instead of the regular /api/pagos/crypto route (non-Elite tiers only).
  // Matched by tier slug, not package id, so the 15-day Elite package rides it too.
  const isEliteMode = packageTierSlug(selectedPkg) === 'elite'

  // Self-serve renewal: /pagos?renew=<post_id> pre-binds the checkout to a
  // post — the paid activation extends its expiry automatically (the post id
  // travels to the payment APIs, never priced client-side).
  const [renewPost, setRenewPost] = useState<{ id: string; title: string | null; tier: string | null } | null>(null)

  // Lock crypto + USDT-TRC20 when the URL explicitly requests Elite — that way
  // a deep-link like /pagos?plan=elite can't be bypassed by the user toggling
  // payment method (not strictly needed since tier Elite forces crypto anyway,
  // but keeps the UX aligned with the marketing flow).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const plan = params.get('plan') || params.get('package')
    if (plan === 'elite') {
      setSelectedPkg('tier_elite')
      setPayMethod('crypto')
      setCryptoCurrency('usdttrc20')
    }
    const renewId = params.get('renew')
    if (renewId) {
      ;(async () => {
        const { data } = await supabase
          .from('posts').select('id, title, tier').eq('id', renewId).maybeSingle()
        if (!data) return
        setRenewPost(data)
        // Pre-select the package matching the post's tier (monthly first —
        // the duration toggle still lets the user switch to 15 days).
        const match = CREDIT_PACKAGES.find(
          p => packageTierSlug(p.id) === data.tier && p.duration_days === 30,
        ) ?? CREDIT_PACKAGES.find(p => packageTierSlug(p.id) === data.tier)
        if (match) {
          setSelectedDuration(match.duration_days)
          setSelectedPkg(match.id)
        }
      })()
    }
  }, [])

  // Whenever the user is on Elite, force crypto/USDT-TRC20 — the /api/payments/
  // elite-nowpayments route only accepts that pair today.
  useEffect(() => {
    if (isEliteMode) {
      setPayMethod('crypto')
      setCryptoCurrency('usdttrc20')
    }
  }, [isEliteMode])

  // Force crypto when the selected country has no live local rail — otherwise
  // the page would default to a "local" method with no form to render.
  useEffect(() => {
    const meta = COUNTRIES.find(c => c.id === selectedCountry)
    if (!meta?.localRail) setPayMethod('crypto')
  }, [selectedCountry])

  const [exchangeRates,    setExchangeRates]    = useState<Record<string, number>>({})
  const [ratesUpdatedAt,   setRatesUpdatedAt]   = useState<string | null>(null)
  const [ratesCached,      setRatesCached]      = useState<boolean>(false)
  const [disabledCountries, setDisabledCountries] = useState<Set<string>>(new Set())

  const [paying,    setPaying]    = useState(false)
  const [payError,  setPayError]  = useState<string | null>(null)
  const [payResult, setPayResult] = useState<PayResult | null>(null)

  useEffect(() => {
    // Fetch exchange rates via our cached API route. Route returns DB cache
    // when < 6h old and refreshes from Frankfurter (ECB) otherwise. This avoids
    // hammering the external API on every page load and works offline w/ fallback.
    const loadRates = () => {
      fetch('/api/exchange-rates')
        .then(r => r.json())
        .then(data => {
          if (data.rates) {
            setExchangeRates(data.rates)
            setRatesUpdatedAt(data.updated_at || null)
            setRatesCached(Boolean(data.cached))
          }
        })
        .catch(() => {})
    }
    loadRates()
    // Re-fetch every 6h in case the page stays open that long. Cleanup on unmount.
    const rateInterval = setInterval(loadRates, 6 * 60 * 60 * 1000)

    supabase
      .from('countries')
      .select('slug, active')
      .then(({ data: countryData }) => {
        if (!countryData) return
        const activeSlugs = new Set(
          countryData.filter(c => c.active).map(c => c.slug.toLowerCase())
        )
        const disabled = new Set<string>()
        COUNTRIES.forEach(country => {
          const hasActive = country.countryNames.some(name => activeSlugs.has(name))
          if (!hasActive) disabled.add(country.id)
        })
        setDisabledCountries(disabled)
        // If the currently-selected country got geo-disabled, fall back to
        // the first still-enabled configured country.
        if (disabled.has(selectedCountry)) {
          const firstEnabled = COUNTRIES.find(c => !disabled.has(c.id))
          if (firstEnabled) setSelectedCountry(firstEnabled.id)
        }
      })
    return () => clearInterval(rateInterval)
  }, [])

  const pkg = CREDIT_PACKAGES.find(p => p.id === selectedPkg)!

  // Selected country presentation meta (drives the local-rail label so the
  // method picker is data-driven from COUNTRY_REGISTRY, not branched in JSX).
  const countryMeta = COUNTRIES.find(c => c.id === selectedCountry) ?? COUNTRIES[0]
  // Data-driven: the local rail is live when the selected country declares one
  // in the registry (AR → MercadoPago card, BR → PIX), so a new market is a
  // registry edit, not code surgery.
  const localRail = countryMeta?.localRail ?? null
  const localRailReady = localRail !== null

  const handlePay = async () => {
    if (!pkg) return
    if (!payerEmail.trim() || !/^\S+@\S+\.\S+$/.test(payerEmail)) {
      setPayError('Ingresá un correo válido para enviarte el comprobante.')
      return
    }
    setPaying(true)
    setPayError(null)
    try {
      // Elite uses a dedicated endpoint (different DB table, different webhook)
      // but the response shape is unified: pay_address + pay_amount render the
      // same inline QR/copy-paste UI for every tier.
      const endpoint = isEliteMode ? '/api/payments/elite-nowpayments' : '/api/pagos/crypto'
      const payload  = isEliteMode
        ? { email: payerEmail, package_id: selectedPkg, ...(renewPost ? { renew_post_id: renewPost.id } : {}) }
        : { package_id: selectedPkg, payer_email: payerEmail, currency: cryptoCurrency, ...(renewPost ? { renew_post_id: renewPost.id } : {}) }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.status === 401 || data.error === 'login_required') {
        // Server requires a session (anonymous checkout disabled). Send the
        // user to login and bounce them back here.
        window.location.href = '/ingresar?next=/pagos'
        return
      }
      if (!res.ok || data.error) {
        setPayError(data.error || 'Error al crear el pago')
      } else {
        setPayResult(data)
      }
    } catch {
      setPayError('Error de conexión')
    } finally {
      setPaying(false)
    }
  }

  const handlePix = async () => {
    if (!pkg) return
    if (!payerEmail.trim() || !/^\S+@\S+\.\S+$/.test(payerEmail)) {
      setPayError('Ingresá un correo válido para enviarte el comprobante.')
      return
    }
    setPaying(true)
    setPayError(null)
    try {
      const res = await fetch('/api/pagos/mp/pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_id: selectedPkg, payer_email: payerEmail }),
      })
      const data = await res.json()
      if (res.status === 401 || data.error === 'login_required') {
        window.location.href = '/ingresar?next=/pagos'
        return
      }
      if (!res.ok || data.error) {
        setPayError(data.message || data.error || 'Error al crear el pago')
      } else {
        setPixResult(data)
      }
    } catch {
      setPayError('Error de conexión')
    } finally {
      setPaying(false)
    }
  }

  const resetPayment = () => { setPayResult(null); setPixResult(null); setPayError(null) }

  // Login-first checkout: unless this deployment opted into anonymous
  // checkout, a session is required before showing the payment form. We wait
  // for the cookie read (hasSession === null) so the wall doesn't flash for
  // logged-in users on back navigation.
  if (!ALLOW_ANONYMOUS && hasSession === false) {
    return (
      <div className="min-h-screen bg-[var(--v-bg-base)] text-[var(--v-text-primary)]">
        <div className="max-w-[440px] mx-auto px-4 py-20 text-center">
          <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal tracking-[.2em] uppercase text-[var(--v-accent)] mb-3.5">
            Membresías
          </p>
          <h1 className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[clamp(24px,4vw,32px)] font-normal text-[var(--v-text-primary)] leading-[1.2] mb-4">
            Iniciá sesión para pagar
          </h1>
          <div className="w-10 h-px mx-auto mb-6 bg-[linear-gradient(90deg,transparent,var(--v-accent),transparent)]" />
          <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[13px] font-normal leading-[1.8] text-[var(--v-text-secondary)] mb-8">
            Tu suscripción se activa automáticamente a tu cuenta al confirmarse el pago. Ingresá para continuar.
          </p>
          <Link
            href="/ingresar?next=/pagos"
            className="inline-flex items-center justify-center font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-normal tracking-[.2em] uppercase bg-[var(--v-accent)] text-[var(--v-bg-base)] px-8 py-3.5 rounded-[6px] no-underline transition-colors hover:bg-[var(--v-accent-light)]"
          >
            Iniciar sesión
          </Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        .v-fadein{opacity:0;animation:fadeUp .9s cubic-bezier(.22,1,.36,1) forwards}
        .d1{animation-delay:.1s}.d2{animation-delay:.25s}.d3{animation-delay:.4s}.d4{animation-delay:.55s}
        @keyframes spin{to{transform:rotate(360deg)}}
        /* mobile only */
        @media (min-width: 768px) { .vp-profesional-note { display:none !important } }

        .vp-section{
          background:var(--v-bg-card);border:1px solid rgba(37, 99, 235,0.1);
          border-radius:6px;padding:28px 32px;margin-bottom:16px;
        }
        .vp-section-label{
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:7px;font-weight:400;
          letter-spacing:.26em;text-transform:uppercase;color:var(--v-accent);
          margin-bottom:16px;display:block;
        }

        /* Package cards */
        .vp-pkg{
          display:flex;align-items:center;justify-content:space-between;
          padding:14px 16px;border-radius:6px;border:1px solid rgba(37, 99, 235,0.1);
          cursor:pointer;transition:border-color .3s ease,background .3s ease;
          margin-bottom:8px;
        }
        .vp-pkg:last-child{margin-bottom:0}
        .vp-pkg:hover{border-color:rgba(37, 99, 235,0.25)}
        .vp-pkg.selected{border-color:rgba(37, 99, 235,0.45);background:rgba(37, 99, 235,0.04)}

        /* Radio pills */
        .vp-radio{
          display:flex;align-items:center;gap:8px;padding:10px 16px;
          border:1px solid rgba(37, 99, 235,0.1);border-radius:6px;cursor:pointer;
          transition:border-color .3s ease,background .3s ease;flex:1;
        }
        .vp-radio:hover{border-color:rgba(37, 99, 235,0.25)}
        .vp-radio.selected{border-color:rgba(37, 99, 235,0.45);background:rgba(37, 99, 235,0.04)}
        .vp-radio-dot{
          width:10px;height:10px;border-radius:50%;border:1px solid var(--v-accent-dim);
          flex-shrink:0;transition:background .2s,border-color .2s;
        }
        .vp-radio.selected .vp-radio-dot{background:var(--v-accent);border-color:var(--v-accent)}

        /* Crypto currency selector */
        .vp-crypto-btn{
          display:flex;flex-direction:column;align-items:center;gap:4px;
          padding:12px 16px;border-radius:6px;border:1px solid rgba(37, 99, 235,0.1);
          cursor:pointer;transition:border-color .3s ease,background .3s ease;flex:1;
        }
        .vp-crypto-btn:hover{border-color:rgba(37, 99, 235,0.25)}
        .vp-crypto-btn.selected{border-color:rgba(37, 99, 235,0.45);background:rgba(37, 99, 235,0.04)}

        /* Pay button */
        .vp-pay-btn{
          width:100%;background:var(--v-accent);color:var(--v-bg-base);border:none;
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:9px;font-weight:400;
          letter-spacing:.2em;text-transform:uppercase;
          height:52px;border-radius:6px;cursor:pointer;
          transition:background .3s ease;
        }
        .vp-pay-btn:hover{background:var(--v-accent-light)}
        .vp-pay-btn:disabled{background:rgba(37, 99, 235,0.1);color:var(--v-text-tertiary);cursor:not-allowed}

        .vp-soon-btn{
          width:100%;background:transparent;color:var(--v-text-tertiary);
          border:1px solid rgba(37, 99, 235,0.1);
          font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;font-size:9px;font-weight:400;
          letter-spacing:.2em;text-transform:uppercase;
          height:52px;border-radius:6px;cursor:not-allowed;
        }

        .vp-address{
          font-family:'Courier New',monospace;font-size:11px;
          color:var(--v-text-primary);word-break:break-all;line-height:1.6;
        }

        /* Inline payment result */
        @keyframes vpResultIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        .vp-result-inline{
          animation:vpResultIn .5s cubic-bezier(.22,1,.36,1) forwards;
          margin-top:20px;padding-top:20px;
          border-top:1px solid rgba(37, 99, 235,0.15);
        }
      `}</style>

      <div className="min-h-screen bg-[var(--v-bg-base)] text-[var(--v-text-primary)]">

        <div className="max-w-[600px] mx-auto px-4 py-10">

          <div className="v-fadein d2 text-center mb-12">
            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal tracking-[.2em] uppercase text-[var(--v-accent)] mb-3.5">
              Membresías
            </p>
            <h1 className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[clamp(28px,4vw,36px)] font-normal text-[var(--v-text-primary)] leading-[1.1] mb-5 [font-variant-numeric:tabular-nums]">
              Pagos
            </h1>
            <div className="w-10 h-px mx-auto bg-[linear-gradient(90deg,transparent,var(--v-accent),transparent)]" />
          </div>

          <div className="v-fadein d2 mb-10 rounded-[6px] border border-[rgba(37,99,235,0.25)] bg-[rgba(37,99,235,0.04)] px-5 py-4">
            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal tracking-[.22em] uppercase text-[var(--v-accent)] mb-1.5">
              Activación automática
            </p>
            <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal leading-[1.7] text-[var(--v-text-secondary)]">
              Tu suscripción se activa <b className="text-[var(--v-accent)]">automáticamente</b> en tu cuenta apenas se confirma el pago. ¿Algún inconveniente? {SUPPORT_WHATSAPP_URL ? (
                <>Escribinos por <a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="text-[var(--v-accent)] font-semibold underline">WhatsApp</a></>
              ) : (
                <>Escribinos</>
              )}{SUPPORT_EMAIL ? <> o a <b className="text-[var(--v-accent)]">{SUPPORT_EMAIL}</b></> : null} y te damos una mano.
            </p>
          </div>

          <style>{`
            /* Section headings — matched to /publicar Enviar/Escríbenos
               typography (clamp 13–16px, weight 500, .18em uppercase). */
            .vp-h-big{
              font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
              font-size:clamp(13px, 2.5vw, 16px);
              font-weight:500;
              letter-spacing:.18em;
              text-transform:uppercase;
              color:var(--v-accent);display:block;margin-bottom:20px;
            }
            .vp-pkg-name{
              font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
              font-size:14px;font-weight:400;letter-spacing:.02em;color:var(--v-text-primary);
            }
            .vp-meta-sub{
              font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
              font-size:12px;font-weight:400;letter-spacing:.02em;color:var(--v-text-secondary);
            }
            .vp-meta-tiny{
              font-family:'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
              font-size:10px;font-weight:400;letter-spacing:.01em;
              white-space:nowrap;
            }
          `}</style>

          <div className="v-fadein d3 vp-section">
            <span className="vp-h-big mb-2">
              Niveles de acceso
            </span>
            {activeTierSlugs.has('elite') && (
              <div className="flex justify-center mb-4">
                <EliteQuota variant="banner" copy="short" />
              </div>
            )}
            {renewPost && (
              <div className="mb-4 px-4 py-3 rounded-[10px] border border-[rgba(37,99,235,0.2)] bg-[rgba(37,99,235,0.05)]">
                <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] tracking-[.16em] uppercase text-[var(--v-accent)] font-semibold block">
                  Renovación
                </span>
                <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] text-[var(--v-text-secondary)] block mt-1">
                  Estás renovando <b className="text-[var(--v-text-primary)]">{renewPost.title || 'tu publicación'}</b> — al
                  confirmarse el pago se extiende automáticamente por la duración del plan.
                </span>
              </div>
            )}

            {PUBLIC_DURATIONS.length > 1 && (
              <div className="flex justify-center gap-2 mb-4">
                {PUBLIC_DURATIONS.slice().reverse().map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => pickDuration(d)}
                    className={`font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] tracking-[.18em] uppercase px-4 py-1.5 rounded-full border transition-colors cursor-pointer ${
                      selectedDuration === d
                        ? 'border-[var(--v-accent)] text-[var(--v-accent-strong)] bg-[rgba(37,99,235,0.06)]'
                        : 'border-[rgba(37,99,235,0.15)] text-[var(--v-text-secondary)]'
                    }`}
                  >
                    {d === 30 ? '1 mes' : `${d} días`}
                  </button>
                ))}
              </div>
            )}
            <div className="h-px bg-[rgba(37,99,235,0.12)]" />
            {CREDIT_PACKAGES
              .filter(p => p.duration_days === selectedDuration && activeTierSlugs.has(packageTierSlug(p.id) ?? ''))
              .slice().reverse().map(p => {
              const tierName = p.label.split(' — ')[0].toUpperCase()
              const tierKey = packageTierSlug(p.id) as keyof typeof TIER_FEATURES
              const isSelected = selectedPkg === p.id
              const isElite = packageTierSlug(p.id) === 'elite'
              const features = TIER_FEATURES[tierKey]
              return (
                <div key={p.id}>
                  <div
                    onClick={() => setSelectedPkg(p.id)}
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
                        <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[8px] font-medium tracking-[.22em] uppercase text-[var(--v-bg-base)] bg-[linear-gradient(135deg,#93C5FD,var(--v-accent))] px-[7px] py-0.5 rounded-[6px]">
                          Top
                        </span>
                      )}
                    </span>
                    <span>
                      <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[26px] font-medium tracking-[-.01em] text-[var(--v-accent)] [font-variant-numeric:tabular-nums]">
                        {p.price_usd}
                      </span>
                      <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal tracking-[.16em] text-[var(--v-accent)] ml-1.5">
                        {p.duration_days === 30 ? 'USD/mes' : `USD/${p.duration_days} días`}
                      </span>
                    </span>
                  </div>

                  {isSelected && p.id === 'tier_premium' && (
                    <p className="vp-profesional-note mt-1 mb-3.5 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal tracking-[.04em] leading-[1.7] italic text-[var(--v-text-tertiary)]">
                      No nos olvidamos de ti, profesional ✨
                    </p>
                  )}

                  {isSelected && features && (
                    <div className="bg-[rgba(37,99,235,0.04)] border border-[rgba(37,99,235,0.15)] rounded-[6px] px-[18px] py-4 mb-[18px]">
                      {features.map((f, fi) => (
                        <div
                          key={f.label}
                          className={`flex justify-between items-center py-2 ${fi < features.length - 1 ? 'border-b border-[rgba(37,99,235,0.08)]' : ''}`}
                        >
                          <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[13px] font-normal text-[var(--v-text-secondary)]">
                            {f.label}
                          </span>
                          <span
                            className={`font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[13px] ${f.value === '24/7' ? 'font-medium' : 'font-normal'} ${
                              f.value === '—'
                                ? 'text-[var(--v-text-tertiary)]'
                                : (f.value === '24/7' || f.value === 'Sí')
                                  ? 'text-[var(--v-accent)]'
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
            <p className="mt-5 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-xs font-normal tracking-[.02em] leading-[1.7] text-[rgba(37,99,235,0.75)]">
              Publicada en <strong className="text-[var(--v-accent)] font-semibold">menos de 24 h</strong>. Pago en USD via MercadoPago o criptomoneda. Soporte directo por WhatsApp
            </p>
            <EliteBenefit marginTop={24} />
          </div>

          <div className="v-fadein d3 vp-section">
            <span className="vp-h-big">Tu país</span>
            <div className="flex gap-2">
              {COUNTRIES.filter(c => !disabledCountries.has(c.id)).map(c => (
                <div
                  key={c.id}
                  className={`vp-radio${selectedCountry === c.id ? ' selected' : ''}`}
                  onClick={() => setSelectedCountry(c.id)}
                >
                  <div className="vp-radio-dot" />
                  <span className={`vp-pkg-name inline-flex items-center gap-2 ${selectedCountry === c.id ? 'text-[var(--v-accent)]' : 'text-[var(--v-text-primary)]'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.flag} alt={c.label} className="w-5 h-[14px] object-cover rounded-[6px] shrink-0" />
                    {c.label}
                  </span>
                </div>
              ))}
            </div>
            {Object.keys(exchangeRates).length > 0 && (
              <>
                <div className="flex flex-wrap gap-3 mt-3 items-baseline">
                  <span className="vp-meta-tiny text-[var(--v-accent)] tracking-[.2em] uppercase">
                    Tasa USD hoy
                  </span>
                  {(['ARS', 'CLP', 'BRL'] as const).map(c => (
                    exchangeRates[c] ? (
                      <span key={c} className="vp-meta-tiny text-[var(--v-text-tertiary)]">
                        1 USD ≈ {new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(exchangeRates[c])} {c}
                      </span>
                    ) : null
                  ))}
                </div>
                <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[8px] font-normal tracking-[.08em] text-[var(--v-text-tertiary)] mt-2 leading-[1.6]">
                  Cálculo en moneda local con la tasa diaria del Banco Central Europeo (BCE).
                  {ratesUpdatedAt ? ` · Actualizada ${formatRelativeTime(ratesUpdatedAt)}${ratesCached ? ' (caché)' : ''}.` : ''}
                  {' '}Los montos en moneda local son referenciales y pueden variar al momento del pago.
                </p>
              </>
            )}
          </div>

          <div className="v-fadein d3 vp-section">
            <span className="vp-h-big">Método de pago</span>
            <div className="flex gap-2 mb-4">
              {!isEliteMode && localRailReady && (
                <div className={`vp-radio${payMethod === 'local' ? ' selected' : ''}`} onClick={() => setPayMethod('local')}>
                  <div className="vp-radio-dot" />
                  <div className="min-w-0">
                    <span className={`vp-pkg-name block ${payMethod === 'local' ? 'text-[var(--v-accent)]' : 'text-[var(--v-text-primary)]'}`}>
                      {countryMeta?.localMethodLabel ?? 'Pago local'}
                    </span>
                    <span className="vp-meta-tiny text-[var(--v-success)]">Disponible ahora</span>
                  </div>
                </div>
              )}
              <div className={`vp-radio${payMethod === 'crypto' ? ' selected' : ''}`} onClick={() => setPayMethod('crypto')}>
                <div className="vp-radio-dot" />
                <div className="min-w-0">
                  <span className={`vp-pkg-name block ${payMethod === 'crypto' ? 'text-[var(--v-accent)]' : 'text-[var(--v-text-primary)]'}`}>
                    {isEliteMode ? 'Cripto (USDT TRC-20)' : 'Cripto'}
                  </span>
                  <span className="vp-meta-tiny text-[var(--v-success)]">Disponible ahora</span>
                </div>
              </div>
            </div>

            {payMethod === 'crypto' && (
              <div className="border-t border-[rgba(37,99,235,0.08)] pt-4">
                <span className="vp-h-big mb-3">Moneda</span>
                <div className="flex gap-2">
                  {CRYPTO_CURRENCIES.filter(c => c.id === 'usdttrc20').map(c => (
                    <div
                      key={c.id}
                      className={`vp-crypto-btn max-w-[180px]${cryptoCurrency === c.id ? ' selected' : ''}`}
                      onClick={() => setCryptoCurrency(c.id)}
                    >
                      <span className={`font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-xl font-normal [font-variant-numeric:tabular-nums] ${cryptoCurrency === c.id ? 'text-[var(--v-accent)]' : 'text-[var(--v-text-tertiary)]'}`}>{c.icon}</span>
                      <span className={`font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[13px] font-normal tracking-[.02em] ${cryptoCurrency === c.id ? 'text-[var(--v-accent)]' : 'text-[var(--v-text-primary)]'}`}>{c.label}</span>
                      <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal tracking-[.02em] text-[var(--v-text-tertiary)]">{c.network}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="v-fadein d4 vp-section !border-[rgba(37,99,235,0.12)]">
            {/* Receipt email — required for every crypto purchase now. MP Bricks
                (local / tarjeta) still treats it as optional since MP collects
                the payer's email at the card form layer. */}
            <div className="mb-5">
              <label className="vp-h-big mb-3">
                {payMethod === 'crypto' || localRail === 'pix' ? 'Tu comprobante (requerido)' : 'Tu comprobante (opcional)'}
              </label>
              <input
                type="email"
                placeholder="tu@email.com"
                value={payerEmail}
                onChange={e => { setPayerEmail(e.target.value); setPayError(null) }}
                className="w-full bg-[var(--v-bg-base)] border border-[rgba(37,99,235,0.25)] px-3.5 py-3 rounded-[6px] outline-none text-[var(--v-text-primary)] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-sm font-normal tracking-[.04em] box-border [font-variant-numeric:tabular-nums]"
              />
            </div>

            <div className="mb-5">
              <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[15px] font-normal text-[var(--v-text-primary)] mb-1 [font-variant-numeric:tabular-nums]">
                {pkg.label}
                {pkg.price_usd && exchangeRates.ARS ? (
                  <span className="text-[var(--v-text-tertiary)] text-[13px] ml-2">
                    ≈ {new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(pkg.price_usd * exchangeRates.ARS)} ARS
                  </span>
                ) : null}
              </p>
              <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-xs font-normal tracking-[.02em] text-[var(--v-text-tertiary)] [font-variant-numeric:tabular-nums]">
                {payMethod === 'crypto' ? 'Vía USDT' : localRail === 'pix' ? 'Vía PIX' : 'Vía pago local'}
              </p>
            </div>

            {payError && (
              <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal tracking-[.18em] text-[var(--v-error)] bg-[rgba(224,85,85,0.05)] border border-[rgba(224,85,85,0.15)] rounded-[6px] px-3.5 py-2.5 mb-4 [font-variant-numeric:tabular-nums]">
                {payError}
              </p>
            )}

            {payMethod === 'crypto' ? (
              <>
                <button
                  className="vp-pay-btn !h-auto p-[18px] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] !text-[clamp(13px,2.5vw,16px)] font-medium !tracking-[.18em] uppercase [font-variant-numeric:tabular-nums]"
                  onClick={handlePay}
                  disabled={paying || !!payResult}
                >
                  {paying ? (
                    <span className="flex items-center justify-center gap-2.5">
                      <span className="inline-block w-[18px] h-[18px] border border-[rgba(8,8,8,0.3)] border-t-[var(--v-bg-base)] rounded-full animate-spin" />
                      Generando…
                    </span>
                  ) : payResult ? 'Pago generado ✓' : 'Pagar'}
                </button>

                {payResult && (
                  <div className="vp-result-inline">
                    <div className="text-center mb-5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(payResult.pay_address)}&bgcolor=FFFFFF&color=1D4ED8&margin=8`}
                        alt="QR de pago"
                        width={200}
                        height={200}
                        className="rounded-[6px] border border-[rgba(37,99,235,0.15)] inline-block"
                      />
                    </div>

                    <div className="text-center mb-4">
                      <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[32px] font-normal text-[var(--v-accent)] [font-variant-numeric:tabular-nums]">
                        {payResult.pay_amount}
                      </span>
                      <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] ml-2.5 [font-variant-numeric:tabular-nums]">
                        {payResult.pay_currency?.toUpperCase()}
                      </span>
                    </div>

                    <div className="mb-5">
                      <Countdown seconds={20 * 60} />
                    </div>

                    <div className="mb-4">
                      <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[7px] font-normal tracking-[.2em] uppercase text-[var(--v-text-tertiary)] block mb-2">
                        Dirección de pago
                      </span>
                      <div className="flex gap-2 items-start bg-[var(--v-bg-base)] border border-[rgba(37,99,235,0.1)] rounded-[6px] px-3.5 py-3">
                        <span className="vp-address flex-1">{payResult.pay_address}</span>
                        <CopyButton text={payResult.pay_address} />
                      </div>
                    </div>

                    <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal tracking-[.04em] text-[var(--v-text-tertiary)] leading-[1.8] mb-3">
                      El pago se procesará automáticamente al recibir la confirmación de la blockchain. No cierres esta ventana hasta completar la transferencia.
                    </p>

                    <div className="text-center">
                      <button
                        onClick={resetPayment}
                        className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[7px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] bg-transparent border-none cursor-pointer underline p-1"
                      >
                        ✕ Nuevo pago
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : localRail === 'pix' ? (
              /* PIX (Brazil) — instant QR via MercadoPago. Returns a QR + a
                 copy-paste EMV code; confirmation lands on the same MP webhook
                 and activates through apply_payment_activation. */
              <>
                <button
                  className="vp-pay-btn !h-auto p-[18px] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] !text-[clamp(13px,2.5vw,16px)] font-medium !tracking-[.18em] uppercase [font-variant-numeric:tabular-nums]"
                  onClick={handlePix}
                  disabled={paying || !!pixResult}
                >
                  {paying ? (
                    <span className="flex items-center justify-center gap-2.5">
                      <span className="inline-block w-[18px] h-[18px] border border-[rgba(8,8,8,0.3)] border-t-[var(--v-bg-base)] rounded-full animate-spin" />
                      Generando…
                    </span>
                  ) : pixResult ? 'PIX generado ✓' : 'Generar PIX'}
                </button>

                {pixResult && (
                  <div className="vp-result-inline">
                    {pixResult.qr_code_base64 && (
                      <div className="text-center mb-5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`data:image/png;base64,${pixResult.qr_code_base64}`}
                          alt="QR PIX"
                          width={200}
                          height={200}
                          className="rounded-[6px] border border-[rgba(37,99,235,0.15)] inline-block"
                        />
                      </div>
                    )}

                    {pixResult.qr_code && (
                      <div className="mb-4">
                        <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[7px] font-normal tracking-[.2em] uppercase text-[var(--v-text-tertiary)] block mb-2">
                          Código PIX (copiá y pegá)
                        </span>
                        <div className="flex gap-2 items-start bg-[var(--v-bg-base)] border border-[rgba(37,99,235,0.1)] rounded-[6px] px-3.5 py-3">
                          <span className="vp-address flex-1">{pixResult.qr_code}</span>
                          <CopyButton text={pixResult.qr_code} />
                        </div>
                      </div>
                    )}

                    {pixResult.ticket_url && (
                      <a
                        href={pixResult.ticket_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-center font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal tracking-[.18em] uppercase text-[var(--v-accent)] underline mb-3"
                      >
                        Abrir en MercadoPago
                      </a>
                    )}

                    <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-normal tracking-[.04em] text-[var(--v-text-tertiary)] leading-[1.8] mb-3">
                      El pago se confirma automáticamente al recibir el aviso de MercadoPago. No cierres esta ventana hasta completar el pago.
                    </p>

                    <div className="text-center">
                      <button
                        onClick={resetPayment}
                        className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[7px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] bg-transparent border-none cursor-pointer underline p-1"
                      >
                        ✕ Nuevo pago
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Mercado Pago Bricks — the local rail only surfaces for
                 configured countries with a live processor (AR today), so
                 reaching this branch always means MP. Email is optional;
                 when filled, we pass it through so the receipt is sent. */
              <MercadoPagoBricks
                packageId={pkg.id}
                credits={pkg.credits}
                amountUsd={pkg.price_usd}
                amountArs={pkg.price_local}
                label={pkg.label}
                accessToken={accessToken}
                payerEmail={payerEmail.trim() && /^\S+@\S+\.\S+$/.test(payerEmail) ? payerEmail : undefined}
                renewPostId={renewPost?.id ?? null}
              />
            )}

            <div className="mt-3 flex flex-col gap-1.5">
              <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[8px] font-normal tracking-[.10em] text-[var(--v-text-tertiary)] text-center leading-[1.6]">
                · Al proceder aceptas nuestros{' '}
                <Link href="/terminos" className="text-[var(--v-text-tertiary)] underline">Términos y Condiciones</Link>.
                {payMethod === 'crypto' && ' Los precios en cripto se calculan al momento del pago'}
              </p>
              <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[8px] font-normal tracking-[.10em] text-[var(--v-text-tertiary)] text-center leading-[1.6]">
                · Un mes equivale a 30 días corridos desde que se publica tu perfil
              </p>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
