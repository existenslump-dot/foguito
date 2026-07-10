'use client'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type Theme = 'dark' | 'light'
/** User preference: an explicit theme, or follow the OS (`system`). */
export type ThemePref = Theme | 'system'

interface ThemeContextValue {
  /** Resolved theme actually applied to <html> (`system` → OS result). */
  theme: Theme
  /** Stored preference — drives the segmented system/light/dark control. */
  pref: ThemePref
  setPref: (p: ThemePref) => void
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  pref: 'light',
  setPref: () => {},
  setTheme: () => {},
  toggleTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>('light')
  const [systemTheme, setSystemTheme] = useState<Theme>('light')

  useEffect(() => {
    const stored = localStorage.getItem('app_theme') as ThemePref | null
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrefState(stored)
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemTheme(mq.matches ? 'dark' : 'light')
    const onChange = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme: Theme = pref === 'system' ? systemTheme : pref

  useEffect(() => {
    if (typeof document === 'undefined') return
    const html = document.documentElement
    if (theme === 'dark') {
      html.classList.add('dark')
      html.classList.remove('light')
    } else {
      html.classList.add('light')
      html.classList.remove('dark')
    }
  }, [theme])

  const setPref = (p: ThemePref) => {
    setPrefState(p)
    try { localStorage.setItem('app_theme', p) } catch { /* private mode */ }
  }

  const setTheme = (t: Theme) => setPref(t)
  const toggleTheme = () => setPref(theme === 'dark' ? 'light' : 'dark')

  return (
    <ThemeContext.Provider value={{ theme, pref, setPref, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
