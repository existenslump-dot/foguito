'use client'
import { useState } from 'react'
import type { useGeoCascade } from '@/hooks/useGeoCascade'

type Geo = ReturnType<typeof useGeoCascade>

interface Props {
  geo: Geo
}

export default function GeoCascadePicker({ geo }: Props) {
  const [comunaSearch,   setComunaSearch]   = useState('')
  const [comunaDropOpen, setComunaDropOpen] = useState(false)
  const [barrioSearch,   setBarrioSearch]   = useState('')
  const [barrioDropOpen, setBarrioDropOpen] = useState(false)

  return (
    <section className="geo-section">
      <style>{`
        .geo-section { margin-bottom: 4px; }
        .geo-h3 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 15px; color: var(--v-accent);
          letter-spacing: .16em; text-transform: uppercase; margin: 0 0 14px;
        }
        .geo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        @media (max-width: 480px) { .geo-grid { grid-template-columns: 1fr; } }
        .geo-field { position: relative; }
        .geo-field label {
          display: block;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; font-weight: 500; color: var(--v-text-primary); margin-bottom: 7px;
        }
        .geo-input {
          width: 100%; box-sizing: border-box;
          background: var(--v-bg-elevated); border: 1px solid rgba(37, 99, 235,0.1);
          border-radius: 10px; padding: 12px 13px;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 13px; color: var(--v-text-primary); outline: none;
          transition: border-color .15s ease;
        }
        .geo-input:focus { border-color: var(--v-accent); }
        select.geo-input { appearance: none; cursor: pointer; }
        select.geo-input option { background: var(--v-bg-elevated); color: var(--v-text-primary); }
        .geo-input::placeholder { color: var(--v-text-tertiary); }

        .geo-drop {
          position: absolute; top: 100%; left: 0; right: 0; z-index: 50;
          margin-top: 4px;
          background: var(--v-bg-card); border: 1px solid rgba(37, 99, 235,0.18);
          border-radius: 10px; max-height: 200px; overflow-y: auto;
        }
        .geo-drop button {
          display: block; width: 100%; text-align: left;
          padding: 9px 13px; background: transparent; border: none; cursor: pointer;
          border-bottom: 1px solid rgba(37, 99, 235,0.06);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; color: var(--v-text-primary); transition: background .15s ease;
        }
        .geo-drop button:hover { background: rgba(37, 99, 235,0.08); }

        .geo-pill {
          display: flex; align-items: center; gap: 8px;
          background: rgba(37, 99, 235,0.07); border: 1px solid rgba(37, 99, 235,0.3);
          border-radius: 10px; padding: 10px 12px;
        }
        .geo-pill span {
          flex: 1; min-width: 0;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 13px; color: var(--v-accent);
        }
        .geo-pill button {
          background: transparent; border: none; cursor: pointer;
          color: var(--v-error); font-size: 13px; line-height: 1; padding: 0; flex-shrink: 0;
        }

        .geo-toggles { margin-top: 12px; }
        .geo-row {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 12px 14px; margin-bottom: 8px;
          border: 1px solid rgba(37, 99, 235,0.1); background: var(--v-bg-elevated);
          border-radius: 10px;
        }
        .geo-row-lbl {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 13px; font-weight: 500; color: var(--v-text-primary);
        }
        .geo-row-sub {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 11px; color: var(--v-text-tertiary); margin-top: 2px;
        }
        /* min-* overrides the global 44px tap-target rule (globals.css,
           @media pointer:coarse) that would otherwise inflate this <button>
           into a circle. */
        .geo-switch {
          width: 38px; height: 21px; min-width: 38px; min-height: 21px;
          border-radius: 999px; flex-shrink: 0;
          background: rgba(255,255,255,0.1); border: none; cursor: pointer;
          position: relative; padding: 0; transition: background .2s ease;
        }
        .geo-switch::after {
          content: ''; position: absolute; top: 2px; left: 2px;
          width: 17px; height: 17px; border-radius: 50%;
          background: var(--v-text-tertiary); transition: transform .2s ease, background .2s ease;
        }
        .geo-switch.on { background: var(--v-accent); }
        .geo-switch.on::after { transform: translateX(17px); background: var(--v-bg-base); }
      `}</style>

      <h3 className="geo-h3">Ubicación</h3>

      <div className="geo-grid">
        {/* Level 1 — Provincia */}
        <div className="geo-field">
          <label>Provincia</label>
          <select
            value={geo.provinciaId ?? ''}
            onChange={e => { geo.setProvinciaId(e.target.value || null); setComunaSearch(''); setBarrioSearch('') }}
            className="geo-input"
          >
            <option value="">Seleccionar…</option>
            {geo.provincias.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Level 2 — Comuna / Localidad */}
        {geo.provinciaId && geo.comunas.length > 0 && !geo.comunaId && (
          <div className="geo-field">
            <label>Comuna / Localidad</label>
            <input
              type="text" placeholder="Buscar o seleccionar…" value={comunaSearch}
              onChange={e => { setComunaSearch(e.target.value); setComunaDropOpen(true) }}
              onFocus={() => setComunaDropOpen(true)}
              onBlur={() => setTimeout(() => setComunaDropOpen(false), 200)}
              className="geo-input"
            />
            {comunaDropOpen && (() => {
              const filtered = geo.comunas.filter(c => !comunaSearch || c.name.toLowerCase().includes(comunaSearch.toLowerCase()))
              return filtered.length > 0 ? (
                <div className="geo-drop">
                  {filtered.map(c => (
                    <button key={c.id} type="button"
                      onMouseDown={() => { geo.setComunaId(c.id); setComunaSearch(''); setComunaDropOpen(false); setBarrioSearch('') }}
                    >{c.name}</button>
                  ))}
                </div>
              ) : null
            })()}
          </div>
        )}
        {geo.comunaId && (
          <div className="geo-field">
            <label>Comuna / Localidad</label>
            <div className="geo-pill">
              <span>{geo.labels.comuna}</span>
              <button type="button" aria-label="Quitar comuna" onClick={() => geo.setComunaId(null)}>✕</button>
            </div>
          </div>
        )}

        {/* Level 3 — Barrio (only when comuna has barrios) */}
        {geo.comunaId && geo.barrios.length > 0 && (
          <div className="geo-field">
            <label>Barrio</label>
            {geo.barrioId ? (
              <div className="geo-pill">
                <span>{geo.labels.barrio}</span>
                <button type="button" aria-label="Quitar barrio" onClick={() => geo.setBarrioId(null)}>✕</button>
              </div>
            ) : (
              <>
                <input
                  type="text" placeholder="Buscar…" value={barrioSearch}
                  onChange={e => { setBarrioSearch(e.target.value); setBarrioDropOpen(true) }}
                  onFocus={() => setBarrioDropOpen(true)}
                  onBlur={() => setTimeout(() => setBarrioDropOpen(false), 200)}
                  className="geo-input"
                />
                {barrioDropOpen && (() => {
                  const filtered = geo.barrios.filter(b => !barrioSearch || b.name.toLowerCase().includes(barrioSearch.toLowerCase()))
                  return filtered.length > 0 ? (
                    <div className="geo-drop">
                      {filtered.map(b => (
                        <button key={b.id} type="button"
                          onMouseDown={() => { geo.setBarrioId(b.id); setBarrioSearch(''); setBarrioDropOpen(false) }}
                        >{b.name}</button>
                      ))}
                    </div>
                  ) : null
                })()}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
