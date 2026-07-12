import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import Link from 'next/link'
import type { Metadata } from 'next'
import { FOGUITO_PACKS } from '@/lib/foguitos/packs'
import { isFoguitoPaymentsEnabled } from '@/lib/foguitos/config'
import { getFoguitoBalance } from '@/lib/credits'
import BuyFoguitosButton from '@/components/BuyFoguitosButton'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Comprar foguitos | Foguito',
  robots: { index: false, follow: false },
}

const MONO = { fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif" } as const

/**
 * /comprar — top-up de foguitos (PR-7 money-in).
 *
 * Gateada por `isFoguitoPaymentsEnabled()`: sin el flag muestra un estado
 * "próximamente" y NO ofrece comprar (riel inerte). Con el flag lista los packs
 * del catálogo server-authoritative + el saldo actual del fan. El PAN nunca toca
 * esta UI: el botón sólo inicia el checkout y muestra/redirige al target hosteado.
 */
export default async function ComprarPage() {
  const enabled = isFoguitoPaymentsEnabled()

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const balance = user ? await getFoguitoBalance(supabase, user.id) : null

  return (
    <main style={{ minHeight: '100vh', background: 'var(--v-bg-base)', color: '#FFFFFF' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '48px 24px' }}>
        <Link
          href="/"
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
          Comprar foguitos
        </h1>
        <p style={{ ...MONO, fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: '28px' }}>
          Los foguitos son crédito interno para desbloquear contenido y suscribirte a creadoras.
        </p>

        {balance !== null && (
          <p
            style={{
              ...MONO,
              display: 'inline-block',
              fontSize: '10px',
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.75)',
              border: '1px solid rgba(37, 99, 235, 0.22)',
              padding: '9px 14px',
              borderRadius: '2px',
              marginBottom: '32px',
            }}
          >
            Saldo actual · {balance.toLocaleString()} foguitos
          </p>
        )}

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
              La compra de foguitos estará disponible próximamente.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '16px',
            }}
          >
            {FOGUITO_PACKS.map((pack) => {
              const priceLabel = `US$${pack.priceAmount}`
              return (
                <div
                  key={pack.id}
                  style={{
                    border: '1px solid rgba(37, 99, 235, 0.18)',
                    borderRadius: '4px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    background: 'rgba(255,255,255,0.015)',
                  }}
                >
                  <div>
                    <p
                      style={{
                        fontFamily: "'Cormorant Garamond', Georgia, serif",
                        fontSize: '32px',
                        fontWeight: 500,
                        lineHeight: 1,
                      }}
                    >
                      {pack.foguitos.toLocaleString()}
                    </p>
                    <p
                      style={{
                        ...MONO,
                        fontSize: '8px',
                        letterSpacing: '.2em',
                        textTransform: 'uppercase',
                        color: 'rgba(255,255,255,0.5)',
                        marginTop: '4px',
                      }}
                    >
                      foguitos
                    </p>
                  </div>
                  <p style={{ ...MONO, fontSize: '14px', color: 'var(--v-accent)' }}>{priceLabel}</p>
                  <div style={{ marginTop: 'auto' }}>
                    <BuyFoguitosButton packId={pack.id} label={`Comprar · ${priceLabel}`} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p
          style={{
            ...MONO,
            fontSize: '9px',
            color: 'rgba(255,255,255,0.4)',
            marginTop: '32px',
            lineHeight: 1.6,
          }}
        >
          El pago se procesa en la plataforma del proveedor. Ningún dato de tu tarjeta pasa por
          Foguito. Los foguitos se acreditan automáticamente al confirmarse el pago.
        </p>
      </div>
    </main>
  )
}
