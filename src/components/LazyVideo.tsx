'use client'
import { useRef, useEffect, useState } from 'react'
import { getVideoPosterUrl } from '@/lib/cloudinary'

interface Props {
  src: string
  controls?: boolean
  controlsList?: string
  style?: React.CSSProperties
  className?: string
}

export default function LazyVideo({ src, controls, controlsList, style, className }: Props) {
  const ref      = useRef<HTMLVideoElement>(null)
  const [ready,  setReady]  = useState(false)
  const [active, setActive] = useState(false)
  const poster = getVideoPosterUrl(src)

  // IntersectionObserver: set src only when in viewport
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.src = src
          setReady(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [src])

  return (
    <div style={{ position: 'relative', lineHeight: 0, ...style }} className={className}>
      <video
        ref={ref}
        poster={poster || undefined}
        preload="none"
        controls={active && controls}
        controlsList={controlsList || 'nodownload'}
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        style={{ width: '100%', display: 'block' }}
        onPlay={() => setActive(true)}
      />
      {/* Play button overlay — hide once user has tapped play */}
      {!active && (
        <div
          onClick={() => {
            if (ref.current && ready) {
              setActive(true)
              ref.current.play()
            }
          }}
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', background: 'rgba(8,8,8,0.35)',
          }}
        >
          <div style={{
            width: '52px', height: '52px', borderRadius: '50%',
            background: 'rgba(8,8,8,0.75)', border: '1px solid rgba(37, 99, 235,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}>
            {/* Accent play triangle */}
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M6 3.5L14.5 9L6 14.5V3.5Z" fill="var(--v-accent)" />
            </svg>
          </div>
        </div>
      )}
    </div>
  )
}
