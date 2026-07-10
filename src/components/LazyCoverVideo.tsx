'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Watermarked Cloudinary video URL. Lazy-loaded: not requested until
   *  the component scrolls within ~200px of the viewport. */
  src: string
  /** Poster image shown before the video loads. Uses the post's first
   *  Cloudinary-transformed image so the card never flashes empty. */
  poster?: string | null
  className?: string
  style?: React.CSSProperties
}

/**
 * Cover-video wrapper that defers the network request + decode until the
 * card scrolls near the viewport. Keeps the feed's bandwidth budget
 * bounded: previously every card with `cover_video_url` rendered
 * `<video autoPlay>` immediately, so a 40-card feed made 40 MP4 requests
 * on first paint (scroll janked on mobile, 10–20MB initial load).
 *
 * Design notes:
 * - Single `<video>` element throughout (we only toggle `src`) so the
 *   DOM stays stable and React doesn't re-hydrate a different tag.
 * - `preload="none"` keeps the browser from speculatively fetching when
 *   the element is out of view.
 * - `poster` shows instantly (static image) — visual parity with the
 *   non-video fallback in the feed card.
 * - IntersectionObserver `rootMargin: '200px'` starts loading ~1 screen
 *   below the viewport so the video is ready by the time the user
 *   scrolls to it — no "black card" flash mid-scroll.
 * - One-shot: once intersected, we disconnect the observer (no need to
 *   toggle the video back off, the browser pauses off-viewport autoplay
 *   on its own under its bandwidth heuristics).
 */
export default function LazyCoverVideo({ src, poster, className, style }: Props) {
  const ref = useRef<HTMLVideoElement>(null)
  // Initial state computed once: if the runtime lacks IntersectionObserver
  // (very old browsers / some WebViews), we skip the lazy behavior and
  // load immediately. Computing this in the useState initializer instead
  // of via setState-in-effect avoids React Compiler's cascading-render
  // warning.
  const [shouldLoad, setShouldLoad] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      entries => {
        const hit = entries.find(e => e.isIntersecting)
        if (hit) {
          setShouldLoad(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <video
      ref={ref}
      src={shouldLoad ? src : undefined}
      poster={poster || undefined}
      autoPlay
      loop
      muted
      playsInline
      preload="none"
      className={className}
      style={style}
    />
  )
}
