'use client'
import { useLang } from '@/contexts/LanguageContext'
import { Lang } from '@/lib/i18n'

const LANGS: { code: Lang; label: string }[] = [
  { code: 'es', label: 'ES' },
  { code: 'en', label: 'EN' },
  { code: 'pt', label: 'PT' },
]

export default function LangSelector() {
  const { lang, setLang } = useLang()

  return (
    <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
      {LANGS.map(l => (
        <button
          key={l.code}
          onClick={() => setLang(l.code)}
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontSize: '9px',
            fontWeight: 200,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            background: 'transparent',
            border: lang === l.code
              ? '1px solid rgba(37, 99, 235,0.4)'
              : '1px solid transparent',
            color: lang === l.code ? 'var(--v-accent)' : '#666',
            padding: '4px 6px',
            borderRadius: '2px',
            cursor: 'pointer',
            transition: 'all .3s ease',
            lineHeight: 1,
            minHeight: '24px',
          }}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
