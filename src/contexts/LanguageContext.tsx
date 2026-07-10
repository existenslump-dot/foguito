'use client'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { Lang } from '@/lib/i18n'

interface LangContextValue {
  lang: Lang
  setLang: (l: Lang) => void
}

const LangContext = createContext<LangContextValue>({ lang: 'es', setLang: () => {} })

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('es')

  // Initial state defaults to 'es' so SSR markup is stable; hydrate from
  // localStorage / navigator on the client exactly once. `set-state-in-effect`
  // is the only correct pattern for SSR-safe localStorage reads — a lazy
  // useState initializer would diverge between server and client.
  useEffect(() => {
    const stored = localStorage.getItem('marketplace_lang') as Lang | null
    if (stored && ['es', 'en', 'pt'].includes(stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLangState(stored)
    } else {
      // Auto-detect from browser language
      const browserLang = navigator.language?.slice(0, 2)
      if (browserLang === 'pt') setLangState('pt')
      else if (browserLang === 'en') setLangState('en')
      // Default remains 'es'
    }
  }, [])

  const setLang = (l: Lang) => {
    setLangState(l)
    localStorage.setItem('marketplace_lang', l)
  }

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>
}

export function useLang() {
  return useContext(LangContext)
}
