'use client'
import Link from 'next/link'

export default function PublicarButton() {
  return (
    <Link
      href="/publicar"
      style={{
        fontFamily:"'Montserrat',sans-serif",fontSize:'8px',fontWeight:200,
        letterSpacing:'.2em',textTransform:'uppercase',
        background:'var(--v-accent)',color:'var(--v-bg-base)',
        padding:'10px 22px',borderRadius:'2px',textDecoration:'none',
        transition:'background .4s ease',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--v-accent-light)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--v-accent)'}
    >
      Publicar
    </Link>
  )
}
