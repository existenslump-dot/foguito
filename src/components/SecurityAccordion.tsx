'use client'

import { useState } from 'react'
import Link from 'next/link'

/**
 * Collapsible "How Marketplace operates" block.
 *
 * Collapsed by default: the main line — the one the visitor *needs* to read
 * ("Marketplace never asks for ID or passwords through external channels") —
 * stays visible. A click expands the other three details (how the upload
 * works, what to do if someone claims to be from Marketplace, official
 * support). Collapsing keeps the security notice from dominating the form.
 */

interface Props {
  /**
   * If `true`, starts expanded. Defaults to `false` (collapsed). Useful where
   * the full block should be visible without a click.
   */
  defaultOpen?: boolean
}

export default function SecurityAccordion({ defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mb-5 bg-[rgba(37,99,235,0.04)] border border-[rgba(37,99,235,0.25)] rounded-[2px]">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls="security-accordion-body"
        className="w-full flex items-center gap-3 p-4 bg-transparent border-none cursor-pointer text-left hover:bg-[rgba(37,99,235,0.02)] transition-colors"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--v-accent)] shrink-0"
          aria-hidden="true"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <span className="flex-1 font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[12px] font-medium text-[var(--v-accent-light)] leading-[1.4]">
          <span className="text-[var(--v-accent)]">Marketplace</span> nunca pide DNI ni contraseña por canales externos
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-[var(--v-accent)] shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div id="security-accordion-body" className="px-4 pb-4 pt-1">
          <p className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[9px] font-medium tracking-[.22em] uppercase text-[var(--v-accent)] mb-2.5">
            Cómo opera Marketplace
          </p>
          <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
            <li className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal leading-[1.55] text-[var(--v-text-secondary)]">
              · Vos creás tu cuenta, vos subís tu DNI desde{' '}
              <Link href="/dashboard/verify" target="_blank" className="text-[var(--v-accent-strong)] underline">
                /dashboard/verify
              </Link>
              , vos cargás tus fotos y descripción.
            </li>
            <li className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal leading-[1.55] text-[var(--v-text-secondary)]">
              ·{' '}
              <span className="text-[var(--v-accent-light)] font-medium">
                El equipo de Marketplace NUNCA te va a pedir fotos, DNI ni contraseña por WhatsApp, Instagram, email ni
                ningún canal externo.
              </span>
            </li>
            <li className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal leading-[1.55] text-[var(--v-text-secondary)]">
              · Si alguien dice ser de Marketplace y te pide eso → es estafa o suplantación. Reportalo con el botón
              {' '}&quot;Reportar&quot; del aviso o escribinos a{' '}
              <a href="mailto:seguridad@example.com" className="text-[var(--v-accent-strong)] underline">
                seguridad@example.com
              </a>
              .
            </li>
            <li className="font-['Switzer','Inter','Helvetica_Neue',Arial,sans-serif] text-[11px] font-normal leading-[1.55] text-[var(--v-text-secondary)]">
              · Soporte oficial:{' '}
              <a href="mailto:contacto@example.com" className="text-[var(--v-accent-strong)] underline">
                contacto@example.com
              </a>
              .
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}
