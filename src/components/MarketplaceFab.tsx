'use client'

import { useState, useEffect } from 'react'

export default function MarketplaceFab() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const hero = document.querySelector('#hero-logo')
    if (!hero) {
      // Not on the gateway page — always show. Legitimate external sync
      // (DOM presence → visibility); the Compiler can't tell it apart
      // from a cascade loop but the effect body only sets state once
      // per mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShow(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => setShow(!entry.isIntersecting),
      { threshold: 0.1 },
    )
    observer.observe(hero)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <style>{`
        @keyframes fabIn {
          from { opacity: 0; transform: scale(0.8); }
          to   { opacity: 1; transform: scale(1); }
        }
        .v-fab {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 100;
          width: 52px;
          height: 52px;
          border-radius: 50%;
          border: 1px solid var(--v-border);
          background: var(--v-accent);
          color: var(--v-text-inverse);
          padding: 0;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: var(--v-shadow-elevated);
          transition: transform .4s ease, opacity .4s ease;
        }
        .v-fab:hover { transform: scale(1.08); }
        @media (min-width: 768px) {
          .v-fab { width: 56px; height: 56px; }
        }
        .v-fab svg { display: block; }
      `}</style>
      <button
        className="v-fab"
        aria-label="Volver arriba"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        style={{
          opacity: show ? 1 : 0,
          pointerEvents: show ? 'auto' : 'none',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
    </>
  )
}
