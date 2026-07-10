'use client'
import { supabase } from '@/lib/supabase/client'
import { useState } from 'react'
import type { Post } from '@/lib/types/post'

interface Props {
  post: Post
  onClose: () => void
  onUpdated: (postId: string, patch: Partial<Post>) => void
  onNotify: (text: string, type: 'success' | 'error') => void
}

// Promo pricing / duration bounds. Price is in USD (the display currency on every card).
const PROMO_PRICE_MIN = 1
const PROMO_PRICE_MAX = 1000
const PROMO_DAYS_MIN = 1
const PROMO_DAYS_MAX = 31
const PROMO_DURATION_PRESETS = [1, 7, 15] as const
const DISCOUNT_PRESETS = [10, 20, 30, 50] as const

function formatPromoEnd(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

export default function PromoModal({ post, onClose, onUpdated, onNotify }: Props) {
  const [promoPrice, setPromoPrice] = useState(post.promo_price ? String(post.promo_price) : '')
  const [promoDays,  setPromoDays]  = useState('7')

  const activate = async () => {
    const price = Number(promoPrice)
    if (!Number.isFinite(price) || price < PROMO_PRICE_MIN || price > PROMO_PRICE_MAX) {
      onNotify(`El precio debe estar entre ${PROMO_PRICE_MIN} y ${PROMO_PRICE_MAX} USD`, 'error')
      return
    }
    const days = Number(promoDays)
    if (!Number.isFinite(days) || days < PROMO_DAYS_MIN || days > PROMO_DAYS_MAX) {
      onNotify(`La duración debe estar entre ${PROMO_DAYS_MIN} y ${PROMO_DAYS_MAX} días`, 'error')
      return
    }
    const priceRounded = Math.round(price)
    const daysRounded = Math.round(days)
    const promoEndsAt = new Date(Date.now() + daysRounded * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await supabase.from('posts').update({
      is_promoted: true, promo_price: priceRounded, promo_ends_at: promoEndsAt,
    }).eq('id', post.id)
    if (error) { onNotify('Error al activar promoción', 'error'); return }
    onUpdated(post.id, { is_promoted: true, promo_price: priceRounded, promo_ends_at: promoEndsAt })
    onClose()
    onNotify('Promoción activada', 'success')
  }

  const deactivate = async () => {
    const { error } = await supabase.from('posts').update({
      is_promoted: false, promo_price: null, promo_ends_at: null,
    }).eq('id', post.id)
    if (error) { onNotify('Error al eliminar promoción', 'error'); return }
    onUpdated(post.id, { is_promoted: false, promo_price: null, promo_ends_at: null })
    onClose()
    onNotify('Promoción eliminada', 'success')
  }

  const isPromoted   = !!post.is_promoted
  const currentPrice = Math.round(post.price ?? 0)
  const hasCurrent   = currentPrice > 0
  const promoNum     = Number(promoPrice)
  const promoValid   = Number.isFinite(promoNum) && promoNum > 0
  const promoRounded = Math.round(promoNum)
  const discountPct  = hasCurrent && promoValid && promoRounded < currentPrice
    ? Math.round((1 - promoRounded / currentPrice) * 100)
    : 0
  const discountAbs  = hasCurrent && promoValid ? Math.max(0, currentPrice - promoRounded) : 0
  const daysNum      = Number(promoDays) || 0
  const endsLabel    = formatPromoEnd(daysNum)

  return (
    <div className="vpr-backdrop" onClick={onClose}>
      <style>{`
        @keyframes vpr-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes vpr-rise { from { transform: translateY(24px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        .vpr-backdrop {
          position: fixed; inset: 0; z-index: 800;
          background: rgba(8,8,8,0.8); backdrop-filter: blur(8px);
          display: flex; align-items: flex-end; justify-content: center;
          animation: vpr-fade .2s ease;
        }
        .vpr-sheet {
          width: 100%; max-width: 440px;
          background: var(--v-bg-base);
          border: 1px solid rgba(37, 99, 235,0.18); border-bottom: none;
          border-radius: 22px 22px 0 0;
          padding: 14px 16px 24px;
          max-height: 92vh; overflow-y: auto;
          box-shadow: 0 -20px 60px -10px rgba(0,0,0,0.7);
          animation: vpr-rise .28s cubic-bezier(.22,1,.36,1);
        }
        .vpr-handle { width: 40px; height: 4px; background: rgba(37, 99, 235,0.18); border-radius: 999px; margin: 0 auto 16px; }
        .vpr-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .vpr-ttl-block { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .vpr-ic {
          width: 36px; height: 36px; border-radius: 50%;
          background: rgba(37, 99, 235,0.08); border: 1px solid rgba(37, 99, 235,0.18);
          display: flex; align-items: center; justify-content: center;
          color: var(--v-accent); flex-shrink: 0;
        }
        .vpr-ic svg { width: 16px; height: 16px; }
        .vpr-h2 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 21px; color: var(--v-text-primary);
          line-height: 1; margin: 0;
        }
        .vpr-sub {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10px; color: var(--v-text-tertiary); margin-top: 5px;
          letter-spacing: .1em; text-transform: uppercase;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .vpr-close {
          width: 32px; height: 32px; border-radius: 50%;
          background: var(--v-bg-elevated); border: 1px solid rgba(37, 99, 235,0.1);
          color: var(--v-text-tertiary); cursor: pointer; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .vpr-close svg { width: 13px; height: 13px; }

        .vpr-current {
          background: var(--v-bg-elevated); border: 1px solid rgba(37, 99, 235,0.08);
          border-radius: 10px; padding: 14px 16px; margin-bottom: 16px;
          display: flex; justify-content: space-between; align-items: center; gap: 12px;
        }
        .vpr-current-lbl {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 9px; color: var(--v-text-tertiary);
          letter-spacing: .14em; text-transform: uppercase;
        }
        .vpr-current-val {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 23px; color: var(--v-text-primary);
          margin-top: 5px; line-height: 1;
        }
        .vpr-current-val.gold { color: var(--v-accent); }
        .vpr-u { font-size: .5em; color: var(--v-text-tertiary); margin-left: 4px; letter-spacing: .04em; }
        .vpr-arrow { color: var(--v-accent); display: inline-flex; flex-shrink: 0; }
        .vpr-arrow svg { width: 18px; height: 18px; }

        .vpr-field { margin-bottom: 16px; }
        .vpr-label {
          display: block; font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 12px; font-weight: 500; color: var(--v-text-primary); margin-bottom: 8px;
        }
        .vpr-input-wrap {
          background: var(--v-bg-elevated); border: 1px solid rgba(37, 99, 235,0.1);
          border-radius: 10px; display: flex; align-items: center; padding: 0 14px;
          transition: border-color .2s ease;
        }
        .vpr-input-wrap:focus-within { border-color: var(--v-accent); }
        .vpr-prefix {
          color: var(--v-text-tertiary); font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 12px; font-weight: 500;
          padding-right: 9px; border-right: 1px solid rgba(37, 99, 235,0.1);
          margin-right: 11px; flex-shrink: 0;
        }
        .vpr-input {
          flex: 1; min-width: 0; padding: 12px 0;
          background: transparent; border: 0; outline: 0;
          color: var(--v-text-primary);
          font-family: 'Switzer','Inter',Arial,sans-serif; font-size: 14px; font-weight: 500;
        }
        .vpr-input::placeholder { color: var(--v-text-tertiary); font-weight: 400; }
        .vpr-suffix {
          color: var(--v-accent); font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 12px; font-weight: 600; letter-spacing: .04em; flex-shrink: 0;
        }

        .vpr-chips { display: flex; gap: 6px; margin-top: 8px; }
        .vpr-dc {
          flex: 1; padding: 8px 6px 7px;
          border: 1px solid rgba(37, 99, 235,0.1); border-radius: 999px;
          background: transparent; color: var(--v-text-tertiary);
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 11px; font-weight: 600; letter-spacing: .04em;
          cursor: pointer; transition: color .2s ease, background .2s ease, border-color .2s ease;
        }
        .vpr-dc:hover { color: var(--v-text-primary); }
        .vpr-dc.on { background: rgba(37, 99, 235,0.1); color: var(--v-accent); border-color: rgba(37, 99, 235,0.4); }

        .vpr-dur-chips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .vpr-dur {
          padding: 12px 8px; border: 1px solid rgba(37, 99, 235,0.1);
          border-radius: 10px; background: transparent; text-align: center;
          cursor: pointer; transition: background .2s ease, border-color .2s ease;
        }
        .vpr-dur.on { background: rgba(37, 99, 235,0.1); border-color: rgba(37, 99, 235,0.4); }
        .vpr-dur-v {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 20px; color: var(--v-text-primary); line-height: 1;
        }
        .vpr-dur.on .vpr-dur-v { color: var(--v-accent); }
        .vpr-dur-l {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 9px; color: var(--v-text-tertiary);
          letter-spacing: .14em; text-transform: uppercase; margin-top: 5px;
        }
        .vpr-hint {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10.5px; color: var(--v-text-tertiary); margin-top: 8px; line-height: 1.4;
        }
        .vpr-hint b { color: var(--v-accent-light); font-weight: 600; }

        .vpr-preview {
          background: linear-gradient(135deg, rgba(37, 99, 235,0.08) 0%, rgba(37, 99, 235,0.02) 100%);
          border: 1px solid rgba(37, 99, 235,0.18); border-radius: 10px;
          padding: 14px 16px; margin-bottom: 16px;
        }
        .vpr-preview-ttl {
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10px; font-weight: 600; letter-spacing: .16em;
          text-transform: uppercase; color: var(--v-accent); margin-bottom: 8px;
        }
        .vpr-prow {
          display: flex; justify-content: space-between; align-items: center;
          padding: 5px 0; font-family: 'Switzer','Inter',Arial,sans-serif; font-size: 12px;
        }
        .vpr-k { color: var(--v-text-tertiary); }
        .vpr-v { color: var(--v-text-primary); font-weight: 500; }
        .vpr-v.struck { text-decoration: line-through; color: var(--v-text-tertiary); }
        .vpr-v.green { color: var(--v-success); }
        .vpr-v.gold { color: var(--v-accent); }
        .vpr-prow.total { padding-top: 10px; margin-top: 4px; border-top: 1px solid rgba(37, 99, 235,0.1); }
        .vpr-prow.total .vpr-k {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; color: var(--v-accent-light); font-size: 14px;
        }
        .vpr-prow.total .vpr-v {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 21px; color: var(--v-accent);
        }

        .vpr-cta-row { display: flex; gap: 8px; }
        .vpr-ghost {
          flex-shrink: 0; padding: 13px 20px 12px;
          border: 1px solid rgba(37, 99, 235,0.3); color: var(--v-accent);
          background: transparent; border-radius: 999px; cursor: pointer;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 11px; font-weight: 500; letter-spacing: .06em;
        }
        .vpr-cta {
          flex: 1; padding: 13px 18px 12px;
          background: var(--v-accent); color: var(--v-bg-base);
          border: none; border-radius: 999px; cursor: pointer;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-weight: 600; font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
        }
        .vpr-deactivate {
          display: block; width: 100%; margin-top: 12px; padding: 6px;
          background: transparent; border: none; color: var(--v-error); cursor: pointer;
          font-family: 'Switzer','Inter',Arial,sans-serif;
          font-size: 10px; font-weight: 500; letter-spacing: .1em; text-transform: uppercase;
        }
      `}</style>

      <div className="vpr-sheet" onClick={e => e.stopPropagation()}>
        <div className="vpr-handle" />

        <div className="vpr-head">
          <div className="vpr-ttl-block">
            <span className="vpr-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12 12 4l7 8M12 4v16" />
              </svg>
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 className="vpr-h2">{isPromoted ? 'Editar promoción' : 'Activar promoción'}</h2>
              <div className="vpr-sub">{post.title || 'Publicación'} · tarifa especial</div>
            </div>
          </div>
          <button className="vpr-close" onClick={onClose} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="vpr-current">
          <div>
            <div className="vpr-current-lbl">Precio actual</div>
            <div className="vpr-current-val">
              {hasCurrent ? currentPrice : '—'}<span className="vpr-u">USD</span>
            </div>
          </div>
          <span className="vpr-arrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </span>
          <div style={{ textAlign: 'right' }}>
            <div className="vpr-current-lbl">Precio promo</div>
            <div className="vpr-current-val gold">
              {promoValid ? promoRounded : '—'}<span className="vpr-u">USD</span>
            </div>
          </div>
        </div>

        <div className="vpr-field">
          <label className="vpr-label">Precio promocional</label>
          <div className="vpr-input-wrap">
            <span className="vpr-prefix">USD</span>
            <input
              className="vpr-input"
              type="number"
              inputMode="numeric"
              min={PROMO_PRICE_MIN}
              max={PROMO_PRICE_MAX}
              step={1}
              placeholder="ej. 250"
              value={promoPrice}
              onChange={e => setPromoPrice(e.target.value)}
            />
            {hasCurrent && discountPct > 0 && <span className="vpr-suffix">−{discountPct}%</span>}
          </div>
          {hasCurrent && (
            <div className="vpr-chips">
              {DISCOUNT_PRESETS.map(d => {
                const chipPrice = Math.round(currentPrice * (1 - d / 100))
                const on = promoValid && promoRounded === chipPrice
                return (
                  <button
                    type="button"
                    key={d}
                    className={`vpr-dc ${on ? 'on' : ''}`}
                    onClick={() => setPromoPrice(String(chipPrice))}
                  >
                    −{d}%
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="vpr-field">
          <label className="vpr-label">Duración</label>
          <div className="vpr-dur-chips">
            {PROMO_DURATION_PRESETS.map(d => {
              const on = Number(promoDays) === d
              return (
                <button
                  type="button"
                  key={d}
                  className={`vpr-dur ${on ? 'on' : ''}`}
                  onClick={() => setPromoDays(String(d))}
                >
                  <div className="vpr-dur-v">{d}</div>
                  <div className="vpr-dur-l">{d === 1 ? 'Día' : 'Días'}</div>
                </button>
              )
            })}
          </div>
          <p className="vpr-hint">
            Rango: {PROMO_DAYS_MIN}–{PROMO_DAYS_MAX} días · vence el <b>{endsLabel}</b>
          </p>
        </div>

        <div className="vpr-preview">
          <div className="vpr-preview-ttl">Resumen</div>
          <div className="vpr-prow">
            <span className="vpr-k">Precio anterior</span>
            <span className="vpr-v struck">{hasCurrent ? `${currentPrice} USD` : '—'}</span>
          </div>
          {hasCurrent && discountPct > 0 && (
            <div className="vpr-prow">
              <span className="vpr-k">Descuento aplicado</span>
              <span className="vpr-v green">−{discountAbs} USD (−{discountPct}%)</span>
            </div>
          )}
          <div className="vpr-prow">
            <span className="vpr-k">Badge “En promoción”</span>
            <span className="vpr-v gold">Activado</span>
          </div>
          <div className="vpr-prow total">
            <span className="vpr-k">Nuevo precio</span>
            <span className="vpr-v">{promoValid ? `${promoRounded} USD` : '—'}</span>
          </div>
        </div>

        <div className="vpr-cta-row">
          <button className="vpr-ghost" onClick={onClose}>Cancelar</button>
          <button className="vpr-cta" onClick={activate}>
            {isPromoted ? 'Actualizar promoción' : 'Activar promoción'}
          </button>
        </div>
        {isPromoted && (
          <button className="vpr-deactivate" onClick={deactivate}>
            Desactivar promoción
          </button>
        )}
      </div>
    </div>
  )
}
