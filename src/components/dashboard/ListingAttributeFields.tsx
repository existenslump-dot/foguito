'use client'
import { getAttributeGroups, type AttributeDef } from '@/config/attributes.config'

/**
 * Config-driven listing-attribute editor — renders one input per attribute in
 * src/config/attributes.config.ts (LISTING_ATTRIBUTES), grouped by section.
 *
 * Widget per attribute type:
 *   text        → <input type="text">
 *   number      → <input type="number"> with the optional unit suffix
 *   select      → <select> dropdown
 *   multiselect → checkbox-style chip group (stored as string[])
 *   boolean     → on/off toggle
 *
 * `adminOnly` attributes are editable only for admins; non-admins see a
 * read-only "locked" card (matching the old physical-attributes UX). The component
 * is fully controlled: it reads/writes a single `attributes` object through
 * `value` and reports edits via `onChange(key, val)`.
 *
 * Self-contained `--v-*`-scoped styling so it renders identically inside the
 * edit page and PostCreateForm. Branding/theming is a separate PR.
 */

export type AttributeValue = string | number | boolean | string[] | null
export type AttributeMap = Record<string, AttributeValue>

interface Props {
  isAdmin: boolean
  value: AttributeMap
  onChange: (key: string, val: AttributeValue) => void
}

const Lock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="11" width="14" height="10" rx="1.5" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)

/** Human-readable rendering of a stored value for the locked / read-only card. */
function displayValue(attr: AttributeDef, raw: AttributeValue): string {
  if (raw === null || raw === undefined || raw === '') return ''
  if (Array.isArray(raw)) return raw.join(', ')
  if (typeof raw === 'boolean') return raw ? 'Sí' : 'No'
  if (typeof raw === 'number' && attr.unit) return `${raw} ${attr.unit}`
  return String(raw)
}

export default function ListingAttributeFields({ isAdmin, value, onChange }: Props) {
  const groups = getAttributeGroups()

  const renderEditor = (attr: AttributeDef) => {
    const raw = value[attr.key]

    switch (attr.type) {
      case 'number':
        return (
          <div className="laf-num">
            <input
              type="number"
              className="laf-input"
              value={raw === null || raw === undefined ? '' : String(raw)}
              onChange={e => onChange(attr.key, e.target.value === '' ? null : Number(e.target.value))}
            />
            {attr.unit && <span className="laf-unit">{attr.unit}</span>}
          </div>
        )

      case 'select':
        return (
          <select
            className="laf-input"
            value={typeof raw === 'string' ? raw : ''}
            onChange={e => onChange(attr.key, e.target.value || null)}
          >
            <option value="">Seleccionar…</option>
            {(attr.options ?? []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )

      case 'multiselect': {
        const selected = Array.isArray(raw) ? raw : []
        return (
          <div className="laf-chips">
            {(attr.options ?? []).map(opt => {
              const on = selected.includes(opt)
              return (
                <button
                  key={opt}
                  type="button"
                  className={`laf-chip ${on ? 'on' : ''}`}
                  onClick={() =>
                    onChange(
                      attr.key,
                      on ? selected.filter(x => x !== opt) : [...selected, opt],
                    )
                  }
                >
                  {opt}
                </button>
              )
            })}
          </div>
        )
      }

      case 'boolean':
        return (
          <button
            type="button"
            aria-pressed={raw === true}
            className={`laf-switch ${raw === true ? 'on' : ''}`}
            onClick={() => onChange(attr.key, raw !== true)}
          >
            <span className="laf-switch-knob" />
          </button>
        )

      case 'text':
      default:
        return (
          <input
            type="text"
            className="laf-input"
            value={typeof raw === 'string' ? raw : ''}
            onChange={e => onChange(attr.key, e.target.value || null)}
          />
        )
    }
  }

  return (
    <div className="laf-root">
      <style>{`
        .laf-root { display: flex; flex-direction: column; gap: 22px; }
        .laf-group { margin-bottom: 0; }
        .laf-head {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 14px;
        }
        .laf-head h3 {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 15px; color: var(--v-accent);
          letter-spacing: .16em; text-transform: uppercase; margin: 0;
        }
        .laf-head .laf-note {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 10px; color: var(--v-text-tertiary); letter-spacing: .04em;
        }
        .laf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 520px) { .laf-grid { grid-template-columns: 1fr; } }

        .laf-field label {
          display: block;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; font-weight: 500; color: var(--v-text-primary); margin-bottom: 7px;
        }
        .laf-input {
          width: 100%; box-sizing: border-box;
          background: var(--v-bg-elevated); border: 1px solid rgba(37, 99, 235,0.1);
          border-radius: 10px; padding: 11px 13px;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 13px; color: var(--v-text-primary); outline: none;
          transition: border-color .15s ease;
        }
        .laf-input:focus { border-color: var(--v-accent); }
        select.laf-input { appearance: none; cursor: pointer; }
        select.laf-input option { background: var(--v-bg-elevated); color: var(--v-text-primary); }

        .laf-num { display: flex; align-items: center; gap: 8px; }
        .laf-num .laf-input { flex: 1; min-width: 0; }
        .laf-unit {
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; color: var(--v-text-tertiary); white-space: nowrap;
        }

        .laf-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .laf-chip {
          padding: 8px 13px 7px; border-radius: 999px; cursor: pointer;
          border: 1px solid rgba(37, 99, 235,0.1); background: transparent;
          color: var(--v-text-tertiary);
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 12px; font-weight: 400; transition: color .15s, background .15s, border-color .15s;
        }
        .laf-chip:hover { color: var(--v-text-primary); }
        .laf-chip.on {
          color: var(--v-accent); background: rgba(37, 99, 235,0.08);
          border-color: rgba(37, 99, 235,0.3); font-weight: 500;
        }

        .laf-switch {
          width: 44px; height: 24px; border-radius: 999px; cursor: pointer; padding: 0;
          border: 1px solid rgba(37, 99, 235,0.18); background: var(--v-bg-elevated);
          position: relative; transition: background .15s, border-color .15s;
        }
        .laf-switch.on { background: rgba(37, 99, 235,0.18); border-color: var(--v-accent); }
        .laf-switch-knob {
          position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
          border-radius: 50%; background: var(--v-text-tertiary);
          transition: transform .15s, background .15s;
        }
        .laf-switch.on .laf-switch-knob { transform: translateX(20px); background: var(--v-accent); }

        .laf-locked {
          background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%);
          border: 1px solid rgba(37, 99, 235,0.08);
          border-radius: 10px; padding: 12px 14px;
        }
        .laf-locked .laf-lbl {
          display: flex; align-items: center; gap: 6px;
          font-family: 'Switzer','Inter','Helvetica Neue',Arial,sans-serif;
          font-size: 9px; color: var(--v-text-tertiary);
          letter-spacing: .14em; text-transform: uppercase; margin-bottom: 4px;
        }
        .laf-locked .laf-lbl svg { width: 10px; height: 10px; color: var(--v-text-tertiary); }
        .laf-locked .laf-val {
          font-family: 'Cormorant Garamond','Playfair Display',serif;
          font-weight: 500; font-size: 17px; color: var(--v-text-primary); line-height: 1.1;
        }
      `}</style>

      {groups.map(({ group, attributes }) => (
        <section key={group} className="laf-group">
          <div className="laf-head">
            <h3>{group}</h3>
            {attributes.some(a => a.adminOnly) && !isAdmin && (
              <span className="laf-note">No editables</span>
            )}
          </div>
          <div className="laf-grid">
            {attributes.map(attr => {
              const locked = attr.adminOnly && !isAdmin
              return (
                <div key={attr.key} className="laf-field">
                  {locked ? (
                    <div className="laf-locked">
                      <div className="laf-lbl"><Lock />{attr.label}</div>
                      <div className="laf-val">{displayValue(attr, value[attr.key]) || '—'}</div>
                    </div>
                  ) : (
                    <>
                      <label>{attr.label}</label>
                      {renderEditor(attr)}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
