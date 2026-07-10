'use client'
import { usePathname } from 'next/navigation'
import { useLang } from '@/contexts/LanguageContext'
import { Lang } from '@/lib/i18n'
import { useState, useEffect, useRef } from 'react'

const LANGS: { code: Lang; label: string }[] = [
  { code: 'es', label: 'ES' },
  { code: 'en', label: 'EN' },
  { code: 'pt', label: 'PT' },
]

export default function FloatingLangSelector() {
  const { lang, setLang } = useLang()
  const pathname = usePathname()
  const [open, setOpen] = useState(true)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  void pathname
  return null

  const currentLabel = LANGS.find(l => l.code === lang)?.label ?? 'ES'
  const otherLangs = LANGS.filter(l => l.code !== lang)

  return (
    <>
      <style>{`
        .v-lang-wrap {
          position: fixed;
          bottom: 24px;
          left: 16px;
          z-index: 200;
          display: flex;
          flex-direction: column;
          gap: 2px;
          align-items: flex-start;
          pointer-events: auto;
        }
        .v-lang-chip {
          background: rgba(8,8,8,0.85);
          border: 1px solid rgba(37, 99, 235,0.4);
          border-radius: 2px;
          padding: 3px;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          flex-direction: row; /* expand horizontally instead of stacking vertically */
          gap: 2px;
          align-items: center;
        }
        .v-lang-btn {
          font-family: 'Montserrat', sans-serif;
          font-size: 7px;
          font-weight: 400;
          letter-spacing: .18em;
          text-transform: uppercase;
          padding: 4px 8px;
          border-radius: 2px;
          cursor: pointer;
          transition: color .2s ease, background .2s ease, border-color .2s ease;
          line-height: 1;
          min-height: 22px;
          min-width: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid transparent;
        }
        .v-lang-btn.active {
          background: var(--v-accent); color: var(--v-bg-base); border-color: var(--v-accent);
        }
        .v-lang-btn.option {
          background: transparent; color: var(--v-text-tertiary);
        }
        .v-lang-btn.option:hover { color: var(--v-accent); }
      `}</style>
      <div className="v-lang-wrap" ref={wrapRef}>
        <div className="v-lang-chip">
          <button
            className="v-lang-btn active"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
          >
            {currentLabel}
          </button>
          {open && otherLangs.map(l => (
            <button
              key={l.code}
              className="v-lang-btn option"
              onClick={() => { setLang(l.code); setOpen(false) }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
