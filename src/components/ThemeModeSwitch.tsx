'use client'
import type { ReactNode } from 'react'
import { useTheme, type ThemePref } from '@/contexts/ThemeContext'

/**
 * Segmented system/light/dark theme control (monitor · sun · moon). Replaces
 * the circular ☾/☀ toggle in the global header, gateway and admin topnav. The
 * active option gets an accent-tinted pill; everything runs off `--v-*` tokens
 * so it works in both modes.
 */

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const OPTIONS: { pref: ThemePref; label: string; icon: ReactNode }[] = [
  {
    pref: 'system',
    label: 'Tema del sistema',
    icon: (
      <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true" className="h-[1em] w-[1em]">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    ),
  },
  {
    pref: 'light',
    label: 'Modo claro',
    icon: (
      <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true" className="h-[1em] w-[1em]">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    pref: 'dark',
    label: 'Modo oscuro',
    icon: (
      <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true" className="h-[1em] w-[1em]">
        <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
      </svg>
    ),
  },
]

export default function ThemeModeSwitch({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { pref, setPref } = useTheme()
  const btn = size === 'sm'
    ? 'w-[24px] h-[24px] text-[12px]'
    : 'w-[28px] h-[28px] text-[14px]'
  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="inline-flex shrink-0 items-center gap-[2px] rounded-full border border-[rgba(var(--brand-primary-rgb),0.18)] bg-[rgba(var(--v-bg-base-rgb),0.55)] p-[3px] backdrop-blur-md"
    >
      {OPTIONS.map(o => {
        const active = o.pref === pref
        return (
          <button
            key={o.pref}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            onClick={() => setPref(o.pref)}
            className={`flex items-center justify-center rounded-full border-0 cursor-pointer transition-colors ${btn} ${
              active
                ? 'bg-[rgba(var(--brand-primary-rgb),0.14)] text-[var(--v-accent-strong)]'
                : 'bg-transparent text-[var(--v-text-tertiary)] hover:text-[var(--v-accent-strong)] hover:bg-[rgba(var(--brand-primary-rgb),0.08)]'
            }`}
          >
            {o.icon}
          </button>
        )
      })}
    </div>
  )
}
