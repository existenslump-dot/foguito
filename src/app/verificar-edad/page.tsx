import Link from 'next/link'
import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { getViewerJurisdiction } from '@/lib/age-gate/viewer-geo'
import { requirementFor } from '@/lib/age-gate/jurisdictions'
import { isAgeVerifyEnabled, isProduction } from '@/lib/age-gate/config'
import { StartVerificationButton } from './StartVerificationButton'

export const metadata: Metadata = {
  title: 'Verificación de edad | Marketplace',
  robots: { index: false, follow: false },
}

/**
 * Consumer age-gate landing (PILAR #0). The `/[city]` layout redirects here when
 * the VIEWER's jurisdiction demands age assurance and they don't hold a valid
 * `age_gate_verifications` row.
 *
 * The copy adapts to the requirement, but there is NEVER a trivial checkbox /
 * self-declared birthdate where verification is required — the only way past the
 * gate is a real provider verification (server-authoritative). For `age_gate`
 * jurisdictions we reuse the SAME provider flow as the reinforced gate.
 */
export default async function VerificarEdadPage() {
  const h = await headers()
  const viewer = getViewerJurisdiction(h)
  const requirement = requirementFor(viewer.country, viewer.region)
  const enabled = isAgeVerifyEnabled()

  // No verification needed for this jurisdiction (defensive — the default matrix
  // never returns 'none', but a direct visit should not be stranded).
  if (requirement === 'none') {
    return (
      <Shell
        eyebrow="Acceso"
        title="No se requiere verificación"
        body="Tu región no requiere verificación de edad adicional para continuar."
      >
        <BackHomeLink />
      </Shell>
    )
  }

  const strict = requirement === 'verify_required'
  const eyebrow = 'Verificación de edad'
  const title = strict
    ? 'Verificá tu edad para entrar'
    : 'Confirmá que sos mayor de edad'
  const body = strict
    ? 'Tu jurisdicción exige verificar la edad con un proveedor de identidad antes de acceder a contenido para adultos. No alcanza con declararlo: vas a completar una verificación real (documento / prueba de edad).'
    : 'Para acceder a contenido para adultos necesitás pasar una verificación de edad. Vas a completar una verificación real con nuestro proveedor.'

  // If the real vendor isn't configured in production we can't honestly verify —
  // be explicit instead of offering a CTA that will 503. Outside production the
  // dev stub is available so the flow can be exercised.
  const canStart = enabled || !isProduction()

  return (
    <Shell eyebrow={eyebrow} title={title} body={body}>
      {canStart ? (
        <StartVerificationButton label={strict ? 'Verificar mi edad' : 'Continuar'} />
      ) : (
        <p
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontSize: 13,
            color: '#6a6050',
            lineHeight: 1.7,
            margin: 0,
          }}
        >
          La verificación de edad no está disponible en este momento. Volvé a
          intentarlo más tarde.
        </p>
      )}
      <div style={{ marginTop: 24 }}>
        <BackHomeLink />
      </div>
    </Shell>
  )
}

function BackHomeLink() {
  return (
    <Link
      href="/"
      style={{
        fontFamily: "'Montserrat', sans-serif",
        fontSize: 10,
        fontWeight: 400,
        letterSpacing: 2,
        textTransform: 'uppercase',
        color: 'var(--v-accent)',
        textDecoration: 'none',
      }}
    >
      Volver al inicio
    </Link>
  )
}

function Shell({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--v-bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <p
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontSize: 10,
            fontWeight: 400,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: '#8a7a5a',
            marginBottom: 20,
          }}
        >
          {eyebrow}
        </p>

        <h1
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 'clamp(24px, 4vw, 36px)',
            fontWeight: 400,
            color: '#e8dcc8',
            lineHeight: 1.2,
            marginBottom: 16,
          }}
        >
          {title}
        </h1>

        <div
          style={{
            width: 40,
            height: 1,
            margin: '0 auto 24px',
            background: 'linear-gradient(90deg, transparent, var(--v-accent), transparent)',
          }}
        />

        <p
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontSize: 13,
            fontWeight: 400,
            color: '#6a6050',
            lineHeight: 1.7,
            marginBottom: 32,
          }}
        >
          {body}
        </p>

        {children}
      </div>
    </main>
  )
}
