'use client'
import { usePathname } from 'next/navigation'
import { useTheme } from '@/contexts/ThemeContext'

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const pathname = usePathname()

  if (pathname?.startsWith('/blog')) return null

  return (
    <>
      <style>{`
        .v-theme-wrap {
          position: fixed;
          /* Stacked above the FloatingLangSelector (bottom: 24px → the ~28px
             tall lang chip starts there + 4px gap → theme chip above). */
          bottom: 60px;
          left: 16px;
          z-index: 200;
          pointer-events: auto;
        }
        .v-theme-chip {
          background: rgba(8,8,8,0.85);
          border: 1px solid rgba(37, 99, 235,0.4);
          border-radius: 2px;
          padding: 3px;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          flex-direction: row;
          align-items: center;
        }
        .v-theme-btn {
          font-family: 'Montserrat', sans-serif;
          font-size: 12px;
          font-weight: 400;
          padding: 4px 8px;
          border-radius: 2px;
          cursor: pointer;
          transition: color .2s ease, background .2s ease;
          line-height: 1;
          min-height: 22px;
          min-width: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid transparent;
          background: transparent;
          color: #2563EB;
        }
        .v-theme-btn:hover {
          background: rgba(37, 99, 235,0.08);
        }
      `}</style>
      <div className="v-theme-wrap">
        <div className="v-theme-chip">
          <button
            type="button"
            onClick={toggleTheme}
            className="v-theme-btn"
            aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </div>
    </>
  )
}
