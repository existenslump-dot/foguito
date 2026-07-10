'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { ELITE_MONTHLY_QUOTA } from '@/lib/tiers'

type Variant = 'inline' | 'banner'
type Copy = 'detailed' | 'short'

export default function EliteQuota({ variant = 'inline', copy = 'detailed' }: { variant?: Variant; copy?: Copy }) {
  const [remaining, setRemaining] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fetchTaken = async () => {
      const { count, error } = await supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('tier', 'elite')
        .eq('is_approved', true)
        .eq('status', 'published')
      if (cancelled) return
      const used = error || count == null ? 0 : count
      setRemaining(Math.max(0, ELITE_MONTHLY_QUOTA - used))
      setLoaded(true)
    }
    fetchTaken()
    return () => { cancelled = true }
  }, [])

  // Show fallback while loading too — keeps the slot from collapsing
  const left = remaining ?? ELITE_MONTHLY_QUOTA
  const sold_out = loaded && remaining === 0

  if (variant === 'banner') {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '10px',
        padding: '10px 16px', borderRadius: '2px',
        border: '1px solid rgba(37,99,235,0.5)',
        background: 'linear-gradient(135deg, rgba(37,99,235,0.10), rgba(37, 99, 235,0.04))',
        boxShadow: '0 0 16px rgba(37,99,235,0.12)',
      }}>
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: sold_out ? 'var(--v-error)' : 'var(--v-accent-light)',
          boxShadow: sold_out ? '0 0 8px rgba(224,85,85,0.6)' : '0 0 8px rgba(37,99,235,0.7)',
          animation: sold_out ? undefined : 'elitePulse 2s ease-in-out infinite',
        }} />
        <span style={{
          fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
          fontSize: '11px', fontWeight: 500,
          letterSpacing: '.18em', textTransform: 'uppercase',
          color: 'var(--v-accent-strong)',
        }}>
          {sold_out
            ? 'Cupos agotados — próximo ciclo'
            : (copy === 'short' ? 'Quedan pocos cupos' : `Solo quedan ${left} ${left === 1 ? 'cupo' : 'cupos'} este mes`)}
        </span>
        <style>{`
          @keyframes elitePulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50%      { opacity: 0.55; transform: scale(0.85); }
          }
        `}</style>
      </div>
    )
  }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
      fontSize: '10px', fontWeight: 400,
      letterSpacing: '.14em', textTransform: 'uppercase',
      color: sold_out ? 'rgba(224,85,85,0.85)' : 'var(--v-accent-strong)',
    }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: sold_out ? 'var(--v-error)' : 'var(--v-accent-light)',
      }} />
      {sold_out
        ? 'Cupos agotados — próximo ciclo'
        : (copy === 'short' ? 'Quedan pocos cupos' : `Solo quedan ${left} ${left === 1 ? 'cupo' : 'cupos'} este mes`)}
    </span>
  )
}
