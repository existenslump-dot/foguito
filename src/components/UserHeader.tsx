'use client'
import { supabase } from '@/lib/supabase/client'
import {
  supabaseFetch,
  getUserId,
  parseSession,
  readAuthCookieRaw,
  signOut as directSignOut,
} from '@/lib/supabase/direct'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import MarketplaceWordmark from '@/components/MarketplaceWordmark'
import ThemeModeSwitch from '@/components/ThemeModeSwitch'
import { usePathname } from 'next/navigation'
import { useLang } from '@/contexts/LanguageContext'
import { t, type Lang } from '@/lib/i18n'
import { COUNTRY_LABEL } from '@/config/marketplace.config'

const LANGS: Lang[] = ['es', 'en', 'pt']
const LANG_NAMES: Record<Lang, string> = { es: 'Español', en: 'Inglés', pt: 'Portugués' }

function HeaderLangPill() {
  const { lang, setLang } = useLang()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex items-center gap-1.5 px-2.5 py-[5px] sm:px-3 sm:py-[6px] bg-[rgba(var(--v-bg-base-rgb),0.55)] backdrop-blur-md border border-[rgba(var(--brand-primary-rgb),0.18)] rounded-full text-[var(--v-text-primary)] text-[10px] sm:text-[11px] font-medium tracking-[0.04em] hover:border-[rgba(var(--brand-primary-rgb),0.32)] hover:text-[var(--v-accent-strong)] transition-colors"
      >
        <svg className="w-2.5 h-2.5 text-[var(--v-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" strokeLinecap="round" />
        </svg>
        <span className="sm:hidden">{lang.toUpperCase()}</span>
        <span className="hidden sm:inline">{LANG_NAMES[lang]}</span>
        <svg
          className={`w-2.5 h-2.5 text-[var(--v-text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        >
          <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Idioma"
          className="absolute right-0 mt-2 bg-[rgba(var(--v-bg-base-rgb),0.95)] backdrop-blur-md border border-[rgba(var(--brand-primary-rgb),0.18)] rounded-xl z-[210] py-1.5 flex flex-col min-w-[120px] sm:min-w-[160px] shadow-[var(--v-shadow-elevated)]"
        >
          {LANGS.map(l => {
            const active = l === lang
            return (
              <button
                key={l}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { setLang(l); setOpen(false) }}
                className={`w-full flex items-center px-4 py-2 text-left text-[11px] sm:text-[12px] font-medium tracking-[0.04em] transition-colors ${active ? 'text-[var(--v-accent-strong)]' : 'text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] hover:bg-[rgba(var(--brand-primary-rgb),0.08)]'}`}
              >
                <span className="sm:hidden">{l.toUpperCase()}</span>
                <span className="hidden sm:inline">{LANG_NAMES[l]}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function UserHeader() {
  const pathname = usePathname()
  if (pathname === '/') return null
  if (pathname?.startsWith('/admin')) return null

  return <UserHeaderImpl />
}

function UserHeaderImpl() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [isAdmin,   setIsAdmin]   = useState<boolean | null>(null)
  const { lang } = useLang()

  useEffect(() => {
    let cancelled = false
    let resolved  = false

    const fetchProfile = async (userId: string) => {
      const path = `profiles?select=is_admin,full_name&id=eq.${encodeURIComponent(userId)}&limit=1`
      const { data, error } = await supabaseFetch<{ is_admin: boolean; full_name: string | null }[]>(path)
      if (cancelled) return
      if (error) {
        console.warn('[UserHeader] profile fetch failed, keeping last role', error)
        return
      }
      const row = data?.[0]
      setIsAdmin(!!row?.is_admin)
    }

    const checkSession = () => {
      if (cancelled || resolved) return
      const userId = getUserId()
      if (!userId) return
      resolved = true
      const session = parseSession(readAuthCookieRaw()) as unknown as { user?: { email?: string } } | null
      setUserEmail(session?.user?.email ?? null)
      void fetchProfile(userId)
    }

    checkSession()
    const r1 = setTimeout(checkSession, 250)
    const r2 = setTimeout(checkSession, 750)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          resolved = true
          setUserEmail(session.user.email ?? null)
          await fetchProfile(session.user.id)
        } else if (event === 'SIGNED_OUT') {
          resolved = false
          setUserEmail(null)
          setIsAdmin(false)
        }
      }
    )

    return () => {
      cancelled = true
      clearTimeout(r1)
      clearTimeout(r2)
      subscription.unsubscribe()
    }
  }, [])

  const handleLogout = async () => {
    await Promise.allSettled([
      directSignOut(),
      fetch('/api/auth/signout', { method: 'POST' }),
    ])
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-')) localStorage.removeItem(key)
      })
      sessionStorage.clear()
    } catch { /* ignore */ }
    window.location.replace('/')
  }

  const isLoggedIn = !!userEmail
  const showRight = userEmail !== null || isAdmin !== null

  return (
    <header
      className="sticky top-0 z-[200] flex h-[68px] sm:h-[84px] w-full items-center justify-between sm:justify-end border-b border-[rgba(var(--brand-primary-rgb),0.08)] bg-[rgba(var(--v-bg-base-rgb),0.92)] px-3 sm:px-6 md:backdrop-blur-md sm:relative"
    >
      <Link
        href="/"
        className="flex min-w-0 items-center gap-2 sm:gap-4 no-underline sm:absolute sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2"
        aria-label="Marketplace — Inicio"
      >
        <MarketplaceWordmark size={22} minSize={15} />
        <span
          aria-hidden="true"
          className="shrink-0 rounded-[2px] border border-[rgba(var(--brand-primary-rgb),0.25)] px-2 py-[3px] sm:px-3 sm:py-[5px] md:px-3.5 md:py-[6px] font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] sm:text-[11px] md:text-[12px] font-medium tracking-[.22em] uppercase text-[var(--v-text-secondary)]"
        >
          {COUNTRY_LABEL}
        </span>
      </Link>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <HeaderLangPill />
        <ThemeModeSwitch size="sm" />
        {showRight && (
          isLoggedIn ? (
            <>
              <button
                type="button"
                onClick={handleLogout}
                className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] sm:text-[10px] font-medium tracking-[.22em] uppercase text-[var(--v-text-secondary)] hover:text-[var(--v-error)] bg-transparent border-0 cursor-pointer whitespace-nowrap"
              >
                {t(lang, 'nav_logout')}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/ingresar"
                className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] sm:text-[10px] font-medium tracking-[.22em] uppercase text-[var(--v-text-secondary)] hover:text-[var(--v-accent-strong)] no-underline transition-colors whitespace-nowrap"
              >
                Acceso
              </Link>
              <Link
                href="/registro"
                className="hidden sm:inline-flex items-center font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[10px] font-medium tracking-[.22em] uppercase text-[var(--v-text-inverse)] no-underline bg-[var(--v-accent)] rounded-[2px] px-3 py-[6px] hover:bg-[var(--v-accent-light)] transition-colors"
              >
                Registro
              </Link>
            </>
          )
        )}
      </div>
    </header>
  )
}
