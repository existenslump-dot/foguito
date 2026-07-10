import Link from 'next/link'

export const metadata = {
  title: 'Región no disponible | Marketplace',
}

export default function BlockedPage() {
  return (
    <main style={{
      minHeight: '100vh',
      background: 'var(--v-bg-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 440 }}>
        <p style={{
          fontFamily: "'Montserrat', sans-serif",
          fontSize: 10,
          fontWeight: 400,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: '#8a7a5a',
          marginBottom: 20,
        }}>
          Acceso restringido
        </p>

        <h1 style={{
          fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
          fontSize: 'clamp(24px, 4vw, 36px)',
          fontWeight:400,
          
          color: '#e8dcc8',
          lineHeight: 1.2,
          marginBottom: 16,
        }}>
          Servicio no disponible en tu regi&oacute;n
        </h1>

        <div style={{
          width: 40,
          height: 1,
          margin: '0 auto 24px',
          background: 'linear-gradient(90deg, transparent, var(--v-accent), transparent)',
        }} />

        <p style={{
          fontFamily: "'Montserrat', sans-serif",
          fontSize: 13,
          fontWeight:400,
          color: '#6a6050',
          lineHeight: 1.7,
          marginBottom: 32,
        }}>
          Marketplace no está disponible en tu ubicación.
        </p>

        <Link
          href="/"
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontSize: 10,
            fontWeight: 400,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: 'var(--v-accent)',
            border: '0.5px solid rgba(37, 99, 235,0.3)',
            padding: '12px 28px',
            borderRadius: 2,
            textDecoration: 'none',
            transition: 'border-color .3s ease',
          }}
        >
          Volver al inicio
        </Link>
      </div>
    </main>
  )
}
