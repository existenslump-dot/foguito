'use client'
import { supabase } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Post } from '@/lib/types/post'
import { MARKETPLACE } from '@/config/marketplace.config'

interface Props {
  post: Post
  onClose: () => void
  onUpdated: (postId: string, patch: Partial<Post>) => void
  onNotify: (text: string, type: 'success' | 'error') => void
}

// Cost/duration are display-only here — the API re-reads them from the
// server config; nothing priced client-side ever reaches the purchase.
const BOOST = MARKETPLACE.billing.boost

function formatDate(iso: string | number): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

export default function BoostModal({ post, onClose, onUpdated, onNotify }: Props) {
  // One key per modal open: a double-click or network retry replays the
  // same purchase server-side instead of charging twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [balance, setBalance] = useState<number | null>(null)
  const [buying, setBuying] = useState(false)
  const [insufficient, setInsufficient] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('profiles').select('credits').eq('id', post.user_id).maybeSingle()
      if (!cancelled) setBalance(data?.credits ?? 0)
    })()
    return () => { cancelled = true }
  }, [post.user_id])

  // Mount-time snapshot keeps render pure (mirrors PostCard's mountedAt).
  const [now] = useState(() => Date.now())
  const activeUntil = post.is_boosted && post.boost_ends_at && new Date(post.boost_ends_at).getTime() > now
    ? new Date(post.boost_ends_at).getTime()
    : null
  // Buying while active EXTENDS from the current end (mirrors the RPC).
  const endsAt = Math.max(activeUntil ?? now, now) + BOOST.durationDays * 24 * 60 * 60 * 1000
  const canAfford = balance !== null && balance >= BOOST.credits

  const buy = async () => {
    if (buying) return
    setBuying(true)
    try {
      const res = await fetch('/api/posts/boost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ post_id: post.id, idempotency_key: idempotencyKey }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        onUpdated(post.id, { is_boosted: true, boost_ends_at: body.boost_ends_at ?? new Date(endsAt).toISOString() })
        onClose()
        onNotify(activeUntil ? 'Boost extendido' : 'Boost activado', 'success')
        return
      }
      if (res.status === 402) { setInsufficient(true); return }
      onNotify(body.message || 'Error al activar el boost', 'error')
    } catch {
      onNotify('Error al activar el boost', 'error')
    } finally {
      setBuying(false)
    }
  }

  return (
    <div className="vbo-backdrop" onClick={onClose}>
      <style>{`
        @keyframes vbo-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes vbo-rise { from { transform: translateY(24px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        .vbo-backdrop {
          position: fixed; inset: 0; z-index: 800;
          background: rgba(8,8,8,0.8); backdrop-filter: blur(8px);
          display: flex; align-items: flex-end; justify-content: center;
          animation: vbo-fade .2s ease;
        }
        .vbo-sheet {
          width: 100%; max-width: 440px;
          background: var(--v-bg-base);
          border: 1px solid rgba(37,99,235,0.18); border-bottom: none;
          border-radius: 22px 22px 0 0;
          padding: 14px 16px 24px;
          max-height: 92vh; overflow-y: auto;
          box-shadow: 0 -20px 60px -10px rgba(0,0,0,0.7);
          animation: vbo-rise .28s cubic-bezier(.22,1,.36,1);
        }
        .vbo-handle { width: 40px; height: 4px; background: rgba(37,99,235,0.18); border-radius: 999px; margin: 0 auto 16px; }
        .vbo-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .vbo-ttl-block { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .vbo-ic {
          width: 36px; height: 36px; border-radius: 50%;
          background: rgba(37,99,235,0.08); border: 1px solid rgba(37,99,235,0.18);
          display: flex; align-items: center; justify-content: center;
          color: var(--v-accent); flex-shrink: 0;
        }
        .vbo-ic svg { width: 16px; height: 16px; }
        .vbo-h2 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 21px; color: var(--v-text-primary);
          line-height: 1; margin: 0;
        }
        .vbo-sub {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10px; color: var(--v-text-tertiary); margin-top: 5px;
          letter-spacing: .1em; text-transform: uppercase;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .vbo-close {
          width: 32px; height: 32px; border-radius: 50%;
          background: var(--v-bg-elevated); border: 1px solid rgba(37,99,235,0.1);
          color: var(--v-text-tertiary); cursor: pointer; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .vbo-close svg { width: 13px; height: 13px; }
        .vbo-active {
          background: rgba(37,99,235,0.06); border: 1px solid rgba(37,99,235,0.2);
          border-radius: 10px; padding: 10px 14px; margin-bottom: 16px;
          font-family: 'Switzer','Inter',Arial,sans-serif; font-size: 11.5px;
          color: var(--v-accent-light); line-height: 1.5;
        }
        .vbo-preview {
          background: linear-gradient(135deg, rgba(37,99,235,0.08) 0%, rgba(37,99,235,0.02) 100%);
          border: 1px solid rgba(37,99,235,0.18); border-radius: 10px;
          padding: 14px 16px; margin-bottom: 16px;
        }
        .vbo-preview-ttl {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10px; font-weight: 600; letter-spacing: .16em;
          text-transform: uppercase; color: var(--v-accent); margin-bottom: 8px;
        }
        .vbo-prow {
          display: flex; justify-content: space-between; align-items: center;
          padding: 5px 0; font-family: 'Switzer','Inter',Arial,sans-serif; font-size: 12px;
        }
        .vbo-k { color: var(--v-text-tertiary); }
        .vbo-v { color: var(--v-text-primary); font-weight: 500; }
        .vbo-v.gold { color: var(--v-accent); }
        .vbo-v.red { color: var(--v-error); }
        .vbo-prow.total { padding-top: 10px; margin-top: 4px; border-top: 1px solid rgba(37,99,235,0.1); }
        .vbo-prow.total .vbo-k {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; color: var(--v-accent-light); font-size: 14px;
        }
        .vbo-prow.total .vbo-v {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 21px; color: var(--v-accent);
        }
        .vbo-hint {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary); margin-bottom: 16px; line-height: 1.5;
        }
        .vbo-insufficient {
          background: rgba(224,85,85,0.05); border: 1px solid rgba(224,85,85,0.2);
          border-radius: 10px; padding: 12px 14px; margin-bottom: 16px;
          font-family: 'Switzer','Inter',Arial,sans-serif; font-size: 11.5px;
          color: var(--v-text-secondary); line-height: 1.5;
        }
        .vbo-insufficient a { color: var(--v-accent); font-weight: 600; text-decoration: none; }
        .vbo-cta-row { display: flex; gap: 8px; }
        .vbo-ghost {
          flex-shrink: 0; padding: 13px 20px 12px;
          border: 1px solid rgba(37,99,235,0.3); color: var(--v-accent);
          background: transparent; border-radius: 999px; cursor: pointer;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 11px; font-weight: 500; letter-spacing: .06em;
        }
        .vbo-cta {
          flex: 1; padding: 13px 18px 12px;
          background: var(--v-accent); color: var(--v-bg-base);
          border: none; border-radius: 999px; cursor: pointer;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-weight: 600; font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
        }
        .vbo-cta:disabled { opacity: .55; cursor: default; }
      `}</style>

      <div className="vbo-sheet" onClick={e => e.stopPropagation()}>
        <div className="vbo-handle" />

        <div className="vbo-head">
          <div className="vbo-ttl-block">
            <span className="vbo-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2 4.5 13.5H11L9 22l8.5-11.5H12L13 2Z" />
              </svg>
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 className="vbo-h2">{activeUntil ? 'Extender boost' : 'Boost de visibilidad'}</h2>
              <div className="vbo-sub">{post.title || 'Publicación'} · primero en tu nivel</div>
            </div>
          </div>
          <button className="vbo-close" onClick={onClose} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {activeUntil && (
          <div className="vbo-active">
            Boost activo hasta el <b>{formatDate(activeUntil)}</b> — comprar de nuevo
            extiende la duración desde esa fecha.
          </div>
        )}

        <p className="vbo-hint">
          Tu publicación aparece por encima de las demás de tu nivel en el feed
          durante {BOOST.durationDays} días. Se paga con créditos de tu cuenta,
          sin pasar por el checkout.
        </p>

        <div className="vbo-preview">
          <div className="vbo-preview-ttl">Resumen</div>
          <div className="vbo-prow">
            <span className="vbo-k">Duración</span>
            <span className="vbo-v">{BOOST.durationDays} días</span>
          </div>
          <div className="vbo-prow">
            <span className="vbo-k">Activo hasta</span>
            <span className="vbo-v gold">{formatDate(endsAt)}</span>
          </div>
          <div className="vbo-prow">
            <span className="vbo-k">Tus créditos</span>
            <span className={`vbo-v ${balance !== null && !canAfford ? 'red' : ''}`}>
              {balance === null ? '…' : balance}
            </span>
          </div>
          <div className="vbo-prow total">
            <span className="vbo-k">Costo</span>
            <span className="vbo-v">{BOOST.credits} créditos</span>
          </div>
        </div>

        {(insufficient || (balance !== null && !canAfford)) && (
          <div className="vbo-insufficient">
            No te alcanzan los créditos para este boost.{' '}
            <Link href="/pagos">Cargá créditos</Link> y volvé a intentarlo.
          </div>
        )}

        <div className="vbo-cta-row">
          <button className="vbo-ghost" onClick={onClose}>Cancelar</button>
          <button className="vbo-cta" onClick={buy} disabled={buying || (balance !== null && !canAfford)}>
            {buying ? 'Procesando…' : activeUntil ? 'Extender boost' : 'Activar boost'}
          </button>
        </div>
      </div>
    </div>
  )
}
