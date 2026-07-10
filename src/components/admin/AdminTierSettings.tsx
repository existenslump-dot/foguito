'use client'
import { useCallback, useEffect, useState } from 'react'
import { TIERS, TIER_COLORS } from '@/lib/categories'
import { fetchTierSettingsResult, toActiveSet, DEFAULT_ACTIVE_TIER_SLUGS, type TierSetting } from '@/lib/tier-settings'

type Props = {
  notify: (text: string, type: 'success' | 'error') => void
}

/**
 * Toggle which tiers are publicly offered. Only gates new assignments —
 * existing posts with an inactive tier keep their badge until manually
 * downgraded from the admin publications list.
 */
export default function AdminTierSettings({ notify }: Props) {
  const [settings, setSettings] = useState<TierSetting[]>([])
  const [pending, setPending]   = useState<string | null>(null)
  const [loaded, setLoaded]     = useState(false)
  // Distinguishes "empty table → seed defaults" from "fetch failed →
  // show retry". Before, a silent network failure looked identical to a
  // clean launch — admin could toggle defaults and think it saved while
  // the server had a different (uncommitted) truth.
  const [fetchError, setFetchError] = useState<string | null>(null)

  const loadSettings = useCallback(async (signal: { cancelled: boolean }) => {
    setFetchError(null)
    const { rows, error } = await fetchTierSettingsResult()
    if (signal.cancelled) return
    if (error) {
      setFetchError(error.message)
      setLoaded(true)
      return
    }
    // If the table is empty (pre-migration) seed the UI with the launch
    // defaults so the toggles reflect reality without a second fetch.
    if (rows.length === 0) {
      setSettings(
        TIERS.map(t => ({
          tier_slug: t.id,
          is_active: (DEFAULT_ACTIVE_TIER_SLUGS as ReadonlyArray<string>).includes(t.id),
        })),
      )
    } else {
      setSettings(rows)
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    const signal = { cancelled: false }
    loadSettings(signal)
    return () => { signal.cancelled = true }
  }, [loadSettings])

  // Warn before navigating/reloading while a PATCH is in-flight. Without
  // this, clicking a toggle and immediately closing the tab orphans the
  // request — the server may or may not have received it, and the
  // audit_log entry + local UI state can disagree.
  useEffect(() => {
    if (!pending) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Modern browsers ignore custom text and show a generic dialog,
      // but setting returnValue is still required for Firefox/Safari.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [pending])

  const activeSet = toActiveSet(settings)

  async function togglePatch(tierSlug: string, nextActive: boolean) {
    setPending(tierSlug)
    try {
      const res = await fetch('/api/admin/tier-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier_slug: tierSlug, is_active: nextActive }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Error desconocido' }))
        console.error('[tier-settings-ui] toggle failed', { tierSlug, nextActive, status: res.status, error })
        notify(error ?? 'No se pudo actualizar el tier', 'error')
        return
      }
      // Server-confirmed → update local state.
      setSettings(prev => {
        const next = prev.filter(s => s.tier_slug !== tierSlug)
        next.push({ tier_slug: tierSlug, is_active: nextActive })
        return next
      })
      notify(`${tierSlug} ${nextActive ? 'activado' : 'desactivado'}`, 'success')
    } catch (err) {
      console.error('[tier-settings-ui] toggle threw', err)
      notify(err instanceof Error ? err.message : 'Error de red', 'error')
    } finally {
      setPending(null)
    }
  }

  async function retryLoad() {
    const signal = { cancelled: false }
    setLoaded(false)
    await loadSettings(signal)
  }

  return (
    <section className="adm-card v-fadein d3">
      <div className="adm-card-head">
        <h3>Gestión de tiers</h3>
        <span className="adm-card-ct" style={{ fontFamily: "'Montserrat',sans-serif" }}>
          Aplica a <b style={{ color: 'var(--v-accent)' }}>/planes</b>
        </span>
      </div>
      <div className="p-5">
      <p style={{
        fontFamily: "'Montserrat',sans-serif", fontSize: '10px', fontWeight: 400,
        color: 'var(--v-text-tertiary)', marginBottom: '20px', lineHeight: 1.6,
      }}>
        Activar/desactivar qué niveles se muestran en <b>/planes</b> y en el
        selector público de tier. No afecta anuncios existentes — conservan
        su badge hasta que los modifiques manualmente.
      </p>

      {fetchError && (
        <div style={{
          background: 'rgba(224,85,85,0.06)',
          border: '1px solid rgba(224,85,85,0.28)',
          borderRadius: '2px', padding: '14px 18px',
          marginBottom: '16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: '240px' }}>
            <span style={{ fontFamily: "'Montserrat',sans-serif", fontSize: '9px', fontWeight: 400, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--v-error)' }}>
              No se pudieron cargar los tiers
            </span>
            <span style={{ fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '11px', fontWeight: 400, color: '#b08080' }}>
              Los toggles siguen reflejando un estado aproximado hasta reintentar. No guardes cambios mientras este aviso esté presente.
            </span>
          </div>
          <button
            type="button"
            onClick={retryLoad}
            style={{
              fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif", fontSize: '9px', fontWeight: 400,
              letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--v-accent)',
              background: 'transparent', border: '1px solid var(--v-accent)', padding: '8px 16px',
              borderRadius: '2px', cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '12px',
      }}>
        {TIERS.map(t => {
          const isActive = activeSet.has(t.id)
          const isPending = pending === t.id
          const color = TIER_COLORS[t.id] ?? 'var(--v-accent)'

          return (
            <div
              key={t.id}
              style={{
                background: 'var(--v-bg-card)',
                border: `1px solid ${isActive ? 'rgba(106,176,106,0.28)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: '2px',
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                opacity: isPending ? 0.5 : 1,
                transition: 'border-color .3s, opacity .2s',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{
                  fontFamily: "'Montserrat',sans-serif", fontSize: '9px', fontWeight: 400,
                  letterSpacing: '.22em', textTransform: 'uppercase',
                  color: isActive ? color : '#555',
                }}>
                  Nivel
                </span>
                <span style={{
                  fontFamily: "'Switzer','Inter','Helvetica Neue',Arial,sans-serif",
                  fontSize: '18px', fontWeight: 500,
                  color: isActive ? 'var(--v-text-primary)' : '#666',
                }}>
                  {t.label}
                </span>
              </div>

              <button
                onClick={() => !isPending && togglePatch(t.id, !isActive)}
                disabled={isPending || !loaded || !!fetchError}
                aria-label={`${isActive ? 'Desactivar' : 'Activar'} ${t.label}`}
                style={{
                  width: '44px', height: '22px', borderRadius: '12px',
                  position: 'relative', padding: 0, boxSizing: 'border-box',
                  cursor: isPending ? 'wait' : 'pointer',
                  background: isActive ? 'rgba(80,160,80,0.22)' : 'rgba(255,255,255,0.04)',
                  border: isActive ? '1px solid rgba(80,160,80,0.55)' : '1px solid rgba(255,255,255,0.1)',
                  transition: 'background .3s, border-color .3s',
                }}
              >
                <div style={{
                  position: 'absolute', top: '1px',
                  left: isActive ? '23px' : '1px',
                  width: '18px', height: '18px', borderRadius: '50%',
                  background: isActive ? 'var(--v-success)' : '#555',
                  transition: 'left .3s',
                }} />
              </button>
            </div>
          )
        })}
      </div>

      <p style={{
        fontFamily: "'Montserrat',sans-serif", fontSize: '8px', fontWeight: 400,
        color: '#555', marginTop: '16px', lineHeight: 1.7,
      }}>
        · Nivel <b>activo</b> → visible en /planes y asignable desde el selector público de tier.<br/>
        · Nivel <b>inactivo</b> → oculto del flujo público; desde /admin/create podés forzarlo manualmente si corresponde (ej. onboarding concierge).<br/>
        · Cada cambio queda registrado en audit_log (quién, cuándo, estado previo). Aplica en vivo, sin deploy.
      </p>
      </div>{/* /.p-5 */}
    </section>
  )
}
