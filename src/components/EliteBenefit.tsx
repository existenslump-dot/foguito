const font = "'Switzer','Inter','Helvetica Neue',Arial,sans-serif"

// Theme-token palette (adapts to light/dark via the .dark overrides in
// globals.css). Mirrors the EliteQuota banner so both Elite callouts read
// as one accent-tinted family instead of a hardcoded dark box.
const ACCENT = 'var(--v-accent-strong)'

export default function EliteBenefit({ marginTop = 32 }: { marginTop?: number }) {
  return (
    <div
      style={{
        marginTop,
        background: 'linear-gradient(135deg, rgba(var(--brand-primary-rgb),0.10), rgba(var(--brand-primary-rgb),0.04))',
        border: '1px solid rgba(var(--brand-primary-rgb),0.25)',
        borderRadius: 2,
        padding: '28px 32px',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontFamily: font, fontSize: 14, fontWeight: 400,
          letterSpacing: '0.08em', color: ACCENT, marginBottom: 16,
        }}
      >
        <span style={{ marginRight: 8 }}>&#x2726;</span>
        Oferta especial 599 USD/mes
      </p>
      <p
        style={{
          fontFamily: font, fontSize: 15, fontWeight: 500,
          color: 'var(--v-text-primary)', lineHeight: 1.5, marginBottom: 14,
        }}
      >
        Creado para profesionales que buscan máxima visibilidad y posicionamiento dentro de la plataforma.
      </p>
      <p
        style={{
          fontFamily: font, fontSize: 13, fontWeight: 400,
          color: 'var(--v-text-secondary)', lineHeight: 1.75, marginBottom: 18,
          maxWidth: 640, marginLeft: 'auto', marginRight: 'auto',
        }}
      >
        Para estar entre los ocho (8) primeros anuncios de la plataforma, consigue destacarte sobre el resto y mejora tus chances de contactar. Para ello contacta con el administrador en{' '}
        <a
          href="mailto:contacto@example.com"
          style={{ color: ACCENT, textDecoration: 'underline' }}
        >
          contacto@example.com
        </a>
        .
      </p>
      <span
        style={{
          display: 'inline-block',
          fontFamily: font, fontSize: 11, fontWeight: 500,
          letterSpacing: '0.2em', textTransform: 'uppercase',
          color: ACCENT, background: 'var(--v-accent-subtle)',
          border: `1px solid rgba(var(--brand-primary-rgb),0.45)`,
          padding: '5px 14px', borderRadius: 2,
        }}
      >
        Elite
      </span>
    </div>
  )
}
