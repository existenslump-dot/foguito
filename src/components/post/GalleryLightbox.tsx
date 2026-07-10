'use client'
import { useEffect, useState } from 'react'
import { ProtectedImage } from '@/components/ProtectedMedia'

export type GalleryItem =
  | { type: 'image'; url: string }
  | { type: 'video'; url: string; poster?: string }

interface Props {
  items: GalleryItem[]
  index: number
  onIndexChange: (next: number) => void
  onClose: () => void
}

export default function GalleryLightbox({ items, index, onIndexChange, onClose }: Props) {
  const [touchStartX, setTouchStartX] = useState(0)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (items.length === 0) return
      if (e.key === 'ArrowLeft')  onIndexChange((index - 1 + items.length) % items.length)
      else if (e.key === 'ArrowRight') onIndexChange((index + 1) % items.length)
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items.length, index, onIndexChange, onClose])

  const current = items[index]
  if (!current) return null

  return (
    <div
      className="vd-lightbox"
      onClick={onClose}
      onTouchStart={e => setTouchStartX(e.touches[0].clientX)}
      onTouchEnd={e => {
        const dx = e.changedTouches[0].clientX - touchStartX
        if (dx < -50) onIndexChange((index + 1) % items.length)
        else if (dx > 50) onIndexChange((index - 1 + items.length) % items.length)
      }}
    >
      {/* Counter */}
      <div style={{ position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', color: 'var(--v-accent)', fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px', fontWeight: 400, letterSpacing: '.18em', zIndex: 9001 }}>
        {index + 1} / {items.length}
      </div>

      {/* Prev */}
      <button
        className="vd-lb-btn"
        onClick={e => { e.stopPropagation(); onIndexChange((index - 1 + items.length) % items.length) }}
        style={{ position: 'fixed', left: '16px', top: '50%', transform: 'translateY(-50%)', zIndex: 9001, background: 'rgba(8,8,8,0.7)', border: '1px solid rgba(37, 99, 235,0.3)', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="var(--v-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>

      {/* Next */}
      <button
        className="vd-lb-btn"
        onClick={e => { e.stopPropagation(); onIndexChange((index + 1) % items.length) }}
        style={{ position: 'fixed', right: '16px', top: '50%', transform: 'translateY(-50%)', zIndex: 9001, background: 'rgba(8,8,8,0.7)', border: '1px solid rgba(37, 99, 235,0.3)', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="var(--v-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>

      {/* Centered neutral image glyph sits behind the swapped-in media so the
          flash between slides reads as a tasteful "no image yet" placeholder
          instead of the previous alt="Foto" text fallback. */}
      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: 8999, pointerEvents: 'none',
          background: "#000 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='1' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20'/%3E%3C/svg%3E\") center/96px no-repeat",
          opacity: 0.35,
        }}
      />
      {current.type === 'video' ? (
        // `key` by url to force a remount when the item changes: an HTML5
        // video doesn't reset autoplay/poster when only the src changes on
        // the same <video> (especially on iOS Safari).
        <video
          key={current.url}
          src={current.url}
          poster={current.poster}
          controls
          controlsList="nodownload"
          playsInline
          onClick={e => e.stopPropagation()}
          style={{ pointerEvents: 'auto', position: 'relative', zIndex: 9000, maxWidth: '100%', maxHeight: '90vh' }}
        />
      ) : (
        <ProtectedImage src={current.url} alt="" onClick={e => e.stopPropagation()} style={{ pointerEvents: 'auto', position: 'relative', zIndex: 9000 }} />
      )}
      <button className="vd-lightbox-close" onClick={onClose}>✕</button>
    </div>
  )
}
