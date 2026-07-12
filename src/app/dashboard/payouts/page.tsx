import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import Link from 'next/link'
import type { Metadata } from 'next'
import { isPayoutEnabled, FOGUITOS_PER_USD_DISPLAY } from '@/lib/payouts/config'
import { getCreatorEarningsBalance } from '@/lib/payouts'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import RequestPayoutButton from '@/components/RequestPayoutButton'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Pagos | Foguito',
  robots: { index: false, follow: false },
}

const MONO = { fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif" } as const

type CreatorRow = {
  payout_kyc_status: string | null
  sanctions_status: string | null
} | null

type PayoutHistoryRow = {
  id: string
  amount_usdt: number | string | null
  amount_foguitos: number | string | null
  status: string
  created_at: string
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  sent: 'Enviado',
  failed: 'Fallido',
  held: 'En revisión',
}

/**
 * /dashboard/payouts — cash-out de earnings de la creadora (PR-8 money-out).
 *
 * Gateada por `isPayoutEnabled()`: sin el flag muestra "próximamente" (riel inerte).
 * Con el flag muestra el balance de earnings, un estimado en USDT (rate de DISPLAY,
 * placeholder), el estado de elegibilidad (payout-KYC + sanciones), un componente
 * de solicitud, y el historial de payouts (RLS: la creadora ve los suyos).
 *
 * ⚠️ El balance de earnings se lee con el service-role admin acotado al id de la
 * SESIÓN (las patas `creator:*:earnings` llevan user_id=NULL → la RLS no deja a la
 * creadora leerlas). El resto (creators/payouts) va por el cliente cookie-scoped/RLS.
 */
export default async function PayoutsPage() {
  const enabled = isPayoutEnabled()

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Balance de earnings — service-role, SIEMPRE acotado al id de la sesión.
  const balance = user ? await getCreatorEarningsBalance(getSupabaseAdmin(), user.id) : 0

  // Estado de elegibilidad + historial (cliente cookie-scoped/RLS: ve lo suyo).
  let creator: CreatorRow = null
  let history: PayoutHistoryRow[] = []
  if (user) {
    const { data: c } = await supabase
      .from('creators')
      .select('payout_kyc_status, sanctions_status')
      .eq('user_id', user.id)
      .maybeSingle<NonNullable<CreatorRow>>()
    creator = c ?? null

    const { data: h } = await supabase
      .from('payouts')
      .select('id, amount_usdt, amount_foguitos, status, created_at')
      .eq('creator_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    history = (h ?? []) as PayoutHistoryRow[]
  }

  const eligible = creator?.payout_kyc_status === 'verified' && creator?.sanctions_status === 'clear'
  const estUsd = balance > 0 && FOGUITOS_PER_USD_DISPLAY > 0 ? balance / FOGUITOS_PER_USD_DISPLAY : 0

  return (
    <main style={{ minHeight: '100vh', background: 'var(--v-bg-base)', color: '#FFFFFF' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '48px 24px' }}>
        <Link
          href="/dashboard"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'var(--v-bg-base)',
            border: '1px solid var(--v-accent)',
            marginBottom: '32px',
            textDecoration: 'none',
          }}
          aria-label="Volver"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 3L5 8L10 13"
              stroke="var(--v-accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>

        <h1
          style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 'clamp(28px, 5vw, 40px)',
            fontWeight: 500,
            marginBottom: '8px',
          }}
        >
          Pagos
        </h1>
        <p style={{ ...MONO, fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: '28px' }}>
          Retirá tus ganancias acumuladas. El pago se procesa de forma regulada tras la
          verificación correspondiente.
        </p>

        {!enabled ? (
          <div
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '4px',
              padding: '32px',
              textAlign: 'center',
            }}
          >
            <p style={{ ...MONO, fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
              Los pagos a creadoras estarán disponibles próximamente.
            </p>
          </div>
        ) : !user ? (
          <div
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '4px',
              padding: '32px',
              textAlign: 'center',
            }}
          >
            <p style={{ ...MONO, fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
              Ingresá para ver tus pagos.
            </p>
          </div>
        ) : (
          <>
            {/* Balance de earnings */}
            <div
              style={{
                border: '1px solid rgba(37, 99, 235, 0.22)',
                borderRadius: '4px',
                padding: '24px',
                marginBottom: '24px',
              }}
            >
              <p
                style={{
                  ...MONO,
                  fontSize: '9px',
                  letterSpacing: '.2em',
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.5)',
                  marginBottom: '8px',
                }}
              >
                Earnings disponibles
              </p>
              <p
                style={{
                  fontFamily: "'Cormorant Garamond', Georgia, serif",
                  fontSize: '40px',
                  fontWeight: 500,
                  lineHeight: 1,
                }}
              >
                {balance.toLocaleString()}
                <span style={{ ...MONO, fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginLeft: '8px' }}>
                  foguitos
                </span>
              </p>
              <p style={{ ...MONO, fontSize: '11px', color: 'var(--v-accent)', marginTop: '8px' }}>
                ≈ US$ {estUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} (estimado)
              </p>
            </div>

            {/* Elegibilidad */}
            <div
              style={{
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '4px',
                padding: '20px',
                marginBottom: '24px',
              }}
            >
              <p
                style={{
                  ...MONO,
                  fontSize: '9px',
                  letterSpacing: '.2em',
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.5)',
                  marginBottom: '12px',
                }}
              >
                Estado de verificación de pago
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <Row label="Payout-KYC" value={creator?.payout_kyc_status ?? 'none'} ok={creator?.payout_kyc_status === 'verified'} />
                <Row label="Sanciones" value={creator?.sanctions_status ?? 'unscreened'} ok={creator?.sanctions_status === 'clear'} />
              </div>
              {!eligible && (
                <p style={{ ...MONO, fontSize: '10px', color: 'rgba(255,255,255,0.55)', marginTop: '12px', lineHeight: 1.6 }}>
                  Para poder retirar necesitás completar la verificación de pago (KYC + screening).
                  El equipo de Foguito la gestiona; te avisaremos cuando estés habilitada.
                </p>
              )}
            </div>

            {/* Solicitud */}
            <div
              style={{
                border: '1px solid rgba(37, 99, 235, 0.18)',
                borderRadius: '4px',
                padding: '20px',
                marginBottom: '32px',
                background: 'rgba(255,255,255,0.015)',
              }}
            >
              <RequestPayoutButton balance={balance} foguitosPerUsd={FOGUITOS_PER_USD_DISPLAY} eligible={eligible} />
            </div>

            {/* Historial */}
            <p
              style={{
                ...MONO,
                fontSize: '9px',
                letterSpacing: '.2em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.5)',
                marginBottom: '12px',
              }}
            >
              Historial
            </p>
            {history.length === 0 ? (
              <p style={{ ...MONO, fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                Todavía no solicitaste ningún pago.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {history.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '3px',
                      padding: '12px 14px',
                    }}
                  >
                    <div>
                      <p style={{ ...MONO, fontSize: '13px' }}>
                        US$ {Number(p.amount_usdt ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </p>
                      <p style={{ ...MONO, fontSize: '9px', color: 'rgba(255,255,255,0.45)' }}>
                        {new Date(p.created_at).toLocaleDateString()} ·{' '}
                        {Number(p.amount_foguitos ?? 0).toLocaleString()} foguitos
                      </p>
                    </div>
                    <span
                      style={{
                        ...MONO,
                        fontSize: '9px',
                        letterSpacing: '.12em',
                        textTransform: 'uppercase',
                        color: 'rgba(255,255,255,0.7)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '999px',
                        padding: '4px 10px',
                      }}
                    >
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ ...MONO, fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>{label}</span>
      <span
        style={{
          ...MONO,
          fontSize: '10px',
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: ok ? '#4ade80' : 'rgba(255,255,255,0.55)',
        }}
      >
        {value}
      </span>
    </div>
  )
}
