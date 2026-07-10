'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { COUNTRY_CODES, type CountryCode } from '@/lib/country-codes'

interface Props {
  value: CountryCode
  onChange: (country: CountryCode) => void
  className?: string
  disabled?: boolean
}

export default function CountryCodePicker({ value, onChange, className, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COUNTRY_CODES
    return COUNTRY_CODES.filter(c =>
      c.name.toLowerCase().includes(q) || c.dial.includes(q),
    )
  }, [query])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 280) })
    }
    // Focus search input shortly after mount (portal renders async).
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handler() { setOpen(false) }
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Cambiar país: ${value.name} ${value.dial}`}
        className={
          className ??
          'flex items-center gap-2 px-3 h-[44px] bg-[var(--v-bg-card)] border border-[rgba(37,99,235,0.18)] rounded-[6px] text-[var(--v-text-primary)] hover:border-[rgba(37,99,235,0.4)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
        }
      >
        <span
          className={`fi fi-${value.iso2.toLowerCase()} rounded-sm`}
          style={{ width: 22, height: 16, display: 'inline-block', flexShrink: 0 }}
          aria-hidden="true"
        />
        <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-medium">
          {value.dial}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && rect && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={dropdownRef}
            role="listbox"
            aria-label="Seleccionar país"
            className="fixed z-[9999] bg-[var(--v-bg-card)] border border-[rgba(37,99,235,0.3)] rounded-[6px] shadow-[0_12px_36px_rgba(0,0,0,0.4)] flex flex-col"
            style={{ top: rect.top, left: rect.left, width: rect.width, maxHeight: '380px' }}
          >
            <div className="p-2 border-b border-[rgba(37,99,235,0.12)]">
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar país o código…"
                aria-label="Buscar país"
                className="w-full bg-[var(--v-bg-base)] border border-[rgba(37,99,235,0.12)] rounded-[4px] px-3 py-2 text-[12px] text-[var(--v-text-primary)] placeholder:text-[var(--v-text-tertiary)] outline-none focus:border-[var(--v-accent)]/40"
              />
            </div>
            <div className="overflow-y-auto flex-1" role="presentation">
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-[11px] text-[var(--v-text-tertiary)] text-center font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif]">
                  Sin resultados para &ldquo;{query}&rdquo;
                </p>
              ) : (
                filtered.map(c => {
                  const selected = c.iso2 === value.iso2 && c.dial === value.dial
                  return (
                    <button
                      key={`${c.iso2}-${c.dial}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => { onChange(c); setOpen(false) }}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                        selected
                          ? 'bg-[var(--v-accent)]/10 text-[var(--v-accent-strong)]'
                          : 'text-[var(--v-text-primary)] hover:bg-[rgba(37,99,235,0.06)] hover:text-[var(--v-accent-strong)]'
                      }`}
                    >
                      <span
                        className={`fi fi-${c.iso2.toLowerCase()} rounded-sm flex-shrink-0`}
                        style={{ width: 22, height: 16, display: 'inline-block' }}
                        aria-hidden="true"
                      />
                      <span className="flex-1 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-normal">
                        {c.name}
                      </span>
                      <span className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] text-[var(--v-text-tertiary)] font-mono">
                        {c.dial}
                      </span>
                      {selected && (
                        <span className="text-[var(--v-accent-strong)] text-[10px]" aria-hidden="true">✓</span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
