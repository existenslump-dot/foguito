'use client'
import { useState } from 'react'
import ContentReportModal from './ContentReportModal'

/**
 * Afordancia mínima "Reportar" para las tarjetas de contenido del perfil. La
 * página `/perfil/[slug]` es un server component, así que este wrapper cliente
 * es el que monta el modal (que tiene estado + fetch). Discreto a propósito — un
 * link de texto chico bajo el precio.
 */
export default function ContentReportButton({ contentId }: { contentId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          marginTop: '8px',
          cursor: 'pointer',
          fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
          fontSize: '7px',
          fontWeight: 400,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.35)',
        }}
      >
        Reportar
      </button>
      {open && <ContentReportModal contentId={contentId} onClose={() => setOpen(false)} />}
    </>
  )
}
