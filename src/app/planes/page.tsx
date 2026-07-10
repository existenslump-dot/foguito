'use client'
import { useEffect, useState } from 'react'
import EliteQuota from '@/components/EliteQuota'
import EliteBenefit from '@/components/EliteBenefit'
import { fetchTierSettings, toActiveSet, DEFAULT_ACTIVE_TIER_SLUGS } from '@/lib/tier-settings'
import { PAYMENTS_DISABLED } from '@/lib/maintenance'
import { getPackage } from '@/lib/packages'

const ACCENT = 'var(--v-accent-strong)'
const WHITE = 'var(--v-text-primary)'
const BG = 'var(--v-bg-elevated)'

// Order: Elite → Gold → Silver → Bronze → Basic.
// Slugs are the canonical key; names are a parallel array indexed identically.
// The "Top / Nivel N" labels are NOT stored alongside — they're derived
// dynamically from the *visible* tier count so hiding a tier (via
// tier_settings) collapses the numbering: if only Elite/Silver/Basic are
// active the labels become Top / Nivel II / Nivel I instead of Top / III / I.
const TIER_SLUGS  = ['elite',     'gold',    'silver',    'bronze',    'basic'] as const
const TIER_NAMES  = ['Elite',     'Gold',    'Silver',    'Bronze',    'Basic'] as const

// Maps each display slug → its catalogue package id. Prices are read from the
// server-authoritative catalogue (MARKETPLACE.billing via @/lib/packages) so
// they're never hardcoded here — edit them in marketplace.config.ts.
const TIER_PACKAGE_IDS = ['tier_elite', 'tier_max', 'tier_pro', 'tier_plus', 'tier_premium'] as const

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'] as const

function tierLevelLabel(displayIdx: number, visibleCount: number): string {
  if (displayIdx === 0) return 'Top'
  // Position from the bottom: last visible = Nivel I, etc.
  return `Nivel ${ROMAN[visibleCount - displayIdx] ?? visibleCount - displayIdx}`
}

const FEATURES: { label: string; values: string[] }[] = [
  { label: 'Fotos por pub.',              values: ['18', '15', '12', '9', '6'] },
  { label: 'Videos por pub.',             values: ['3',  '2',  '1',  '—',      '—'] },
  { label: 'Audios por pub.',             values: ['1',  '1',  '—',       '—',      '—'] },
  { label: 'Video de portada',            values: ['✦',  '✦',  '—',  '—',  '—'] },
  { label: 'Historias',                   values: ['✦',  '✦',  '✦',  '✦',  '—'] },
  { label: 'Edita tus fotos',             values: ['✦',  '✦',  '✦',  '✦',  '✦'] },
  { label: 'Edita tu publicación',        values: ['✦',  '✦',  '✦',  '✦',  '✦'] },
  { label: 'Pausas sin costo',            values: ['✦',  '✦',  '✦',  '—',  '—'] },
  { label: 'Verificación de identidad',   values: ['✦',  '✦',  '✦',  '✦',  '✦'] },
  { label: 'Primeras 8',                  values: ['✦',  '—',  '—',  '—',  '—'] },
  { label: 'Soporte',                     values: ['24/7', 'Dedicado', 'Prioritario', 'Estándar', 'Estándar'] },
]

// Prices sourced from the server-authoritative catalogue, parallel-indexed to
// TIER_SLUGS/TIER_NAMES. `num` is the USD figure from MARKETPLACE.billing.
const PRICES = TIER_PACKAGE_IDS.map((pkgId, i) => {
  const pkg = getPackage(pkgId)
  return {
    name: TIER_NAMES[i].toUpperCase(),
    num: pkg ? String(pkg.price_usd) : '—',
    unit: 'USD',
    period: '/mes',
  }
})

type GlossaryBadge =
  | 'all'
  | 'silver-gold-elite'
  | 'bronze-silver-gold-elite'
  | 'gold-elite'
  | 'elite'

// Which tier slugs each glossary badge references. 'all' is always shown
// (at least one tier is always active); the rest only render if any of
// their tiers is currently active.
const BADGE_TIER_SLUGS: Record<GlossaryBadge, readonly string[]> = {
  'all':                    [],
  'silver-gold-elite':       ['silver','gold','elite'],
  'bronze-silver-gold-elite': ['bronze','silver','gold','elite'],
  'gold-elite':             ['gold','elite'],
  'elite':                   ['elite'],
}

const GLOSSARY: { term: string; desc: string; badge: GlossaryBadge }[] = [
  { term: 'Fotos por publicación',    desc: 'Cantidad máxima de imágenes por publicación. A mayor nivel, más capacidad para mostrar tu trabajo.', badge: 'all' },
  { term: 'Video de portada',         desc: 'Reemplaza la foto estática por un video animado que se reproduce en el listado, generando más atención.', badge: 'gold-elite' },
  { term: 'Historias',                desc: 'Videos cortos de 30 segundos que aparecen en el feed de tu ciudad durante 24 horas. Ideales para mostrar contenido dinámico.', badge: 'bronze-silver-gold-elite' },
  { term: 'Edición de fotos',         desc: 'Herramientas de edición integradas para agregar marcas de agua con el nombre de tu página y proteger tus imágenes.', badge: 'all' },
  { term: 'Panel de gestión',         desc: 'Accede a tu panel privado para administrar publicaciones, renovar, promocionar y controlar todos los aspectos de tu perfil.', badge: 'all' },
  { term: 'Pausas sin costo',         desc: 'Suspende temporalmente tu publicación y retómala cuando quieras. Durante la pausa tu perfil se mantiene inactivo, no se descuentan los días del plan y al reactivar continúas con los días restantes.', badge: 'silver-gold-elite' },
  { term: 'Verificación de identidad',desc: 'Sello de perfil verificado que aumenta la confianza de los clientes. Requiere validación progresiva según el nivel.', badge: 'all' },
  { term: 'Soporte prioritario',      desc: 'Canales de soporte con tiempos de respuesta reducidos. En Gold, línea dedicada con agente asignado. En Elite, concierge 24/7.', badge: 'silver-gold-elite' },
  { term: 'Primeros 8',               desc: 'Los anuncios Elite aparecen garantizados entre los 8 primeros de la home de su ciudad, con prioridad máxima sobre el algoritmo. Cuando se llenan los 8 cupos, nuevas entradas se liberan al próximo ciclo mensual.', badge: 'elite' },
]

// Badge chips ride the theme tokens (accent tint over the current surface)
// so they read correctly in light AND dark \u2014 no hardcoded dark backgrounds.
const BADGE_STYLES: Record<GlossaryBadge, { label: string; bg: string; border: string }> = {
  'all':                    { label: 'Todos los niveles',                                    bg: 'var(--v-accent-subtle)', border: `0.5px solid rgba(37, 99, 235,0.15)` },
  'silver-gold-elite':       { label: 'Silver \u00b7 Gold \u00b7 Elite',                       bg: 'var(--v-accent-subtle)', border: `0.5px solid rgba(37, 99, 235,0.25)` },
  'bronze-silver-gold-elite': { label: 'Priv\u00e9 \u00b7 Silver \u00b7 Gold \u00b7 Elite',    bg: 'var(--v-accent-subtle)', border: `0.5px solid rgba(37, 99, 235,0.25)` },
  'gold-elite':             { label: 'Gold \u00b7 Elite',                                    bg: 'var(--v-accent-subtle)', border: `0.5px solid rgba(37, 99, 235,0.3)` },
  'elite':                   { label: 'Exclusivo Elite',                                       bg: 'var(--v-accent-subtle)', border: `0.5px solid rgba(37,99,235,0.45)` },
}

const font = "'Switzer','Inter','Helvetica Neue',Arial,sans-serif"

function renderValue(val: string, isElite: boolean) {
  if (val === '✦') return <span style={{ color: ACCENT, fontSize: 15 }}>&#x2726;</span>
  if (val === '—') return <span style={{ color: 'var(--v-text-tertiary)' }}>&mdash;</span>
  if (['Estándar', 'Prioritario', 'Dedicado', '24/7'].includes(val)) {
    const topRow = val === '24/7'
    return <span style={{ fontFamily: font, fontSize: 13, color: topRow ? ACCENT : WHITE, fontWeight: topRow ? 500 : 400 }}>{val}</span>
  }
  return <span style={{ fontFamily: font, fontSize: 15, color: isElite ? ACCENT : WHITE }}>{val}</span>
}

export default function TiersPage() {
  const [openGlossary, setOpenGlossary] = useState<number | null>(null)
  const [activeTierSlugs, setActiveTierSlugs] = useState<Set<string>>(
    new Set(DEFAULT_ACTIVE_TIER_SLUGS),
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const rows = await fetchTierSettings()
      if (!cancelled) setActiveTierSlugs(toActiveSet(rows))
    })()
    return () => { cancelled = true }
  }, [])

  // Column indices (into TIER_NAMES/TIER_LEVELS/FEATURES.values/PRICES)
  // for currently active tiers. Keeps DB ordering aligned with the
  // hardcoded parallel arrays above.
  const visibleIndexes = TIER_SLUGS
    .map((slug, i) => (activeTierSlugs.has(slug) ? i : -1))
    .filter(i => i >= 0)

  // Drop feature rows that are empty (all "—") across every visible column.
  const visibleFeatures = FEATURES.filter(f =>
    visibleIndexes.some(i => f.values[i] !== '—'),
  )

  // Drop glossary items whose badge tiers are all inactive.
  const visibleGlossary = GLOSSARY.filter(g =>
    g.badge === 'all' || BADGE_TIER_SLUGS[g.badge].some(s => activeTierSlugs.has(s)),
  )

  return (
    <>
      <style>{`
        @keyframes trFadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:none} }
        .tr-fade { opacity:0; animation:trFadeUp .8s cubic-bezier(.22,1,.36,1) forwards }

        /* Table scroll wrapper — desktop only */
        .tr-table-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch }
        .tr-table-wrap::-webkit-scrollbar { height:4px }
        .tr-table-wrap::-webkit-scrollbar-track { background:${BG} }
        .tr-table-wrap::-webkit-scrollbar-thumb { background:rgba(37, 99, 235,0.2); border-radius:6px }

        /* Accordion */
        .gl-body { max-height:0; opacity:0; overflow:hidden; transition:max-height .3s ease, opacity .3s ease }
        .gl-body.open { max-height:220px; opacity:1 }
        .gl-arrow { transition:transform .3s ease; display:inline-block }
        .gl-arrow.open { transform:rotate(90deg) }

        /* Glossary grid */
        .gl-grid { display:grid; grid-template-columns:1fr 1fr; gap:1px; background:rgba(37, 99, 235,0.08) }
        @media(max-width:767px) { .gl-grid { grid-template-columns:1fr } }

        /* Sticky page header */
        .tr-sticky-bar {
          position:sticky; top:0; z-index:40;
          background:${BG};
          display:flex; align-items:center; justify-content:center;
          height:60px; padding:0 16px;
          border-bottom:1px solid rgba(37, 99, 235,0.1);
        }
        .tr-sticky-back {
          position:absolute; left:16px; top:50%; transform:translateY(-50%);
          display:inline-flex; align-items:center; justify-content:center;
          width:32px; height:32px; border-radius:50%;
          background:transparent; border:1px solid rgba(37, 99, 235,0.2);
          transition:border-color .3s ease; cursor:pointer; text-decoration:none;
        }
        .tr-sticky-back:hover { border-color:rgba(37, 99, 235,0.5) }

        /* Desktop table / mobile cards */
        .tr-desktop-table { display:block }
        .tr-mobile-cards { display:none }
        .tr-desktop-prices { display:grid; grid-template-columns:repeat(5,1fr); gap:1px; background:${BG} }

        @media(max-width:767px) {
          .tr-desktop-table { display:none !important }
          .tr-desktop-prices { display:none !important }
          .tr-mobile-cards { display:flex; flex-direction:column; gap:16px }
          .tr-page-pad { padding:40px 16px 48px !important }
          .tr-sticky-back { display:none !important }
          /* Logo stays centered on mobile too (matches /pagos + /publicar) */
        }
      `}</style>

      <main style={{ minHeight: '100vh', background: 'var(--v-bg-base)', color: WHITE }}>
        {PAYMENTS_DISABLED && (
          <div
            style={{
              maxWidth: 720,
              margin: '24px auto 0',
              padding: '14px 20px',
              borderRadius: 6,
              border: '1px solid rgba(37, 99, 235,0.3)',
              background: 'var(--v-accent-subtle)',
              textAlign: 'center',
            }}
          >
            <p
              style={{
                fontFamily: font,
                fontSize: 12,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: ACCENT,
                marginBottom: 4,
              }}
            >
              Pagos en mantención
            </p>
            <p
              style={{
                fontFamily: font,
                fontSize: 13,
                color: 'var(--v-text-secondary)',
                lineHeight: 1.5,
              }}
            >
              Estamos actualizando nuestra infraestructura. Para contratar un plan ahora, escribinos por WhatsApp o Telegram.
            </p>
          </div>
        )}

        <div className="tr-page-pad" style={{ maxWidth: 960, margin: '0 auto', padding: '48px 32px 80px' }}>

          <div className="tr-fade" style={{ animationDelay: '.05s', textAlign: 'center', marginBottom: 56 }}>
            <p style={{
              fontFamily: font, fontSize: 11, fontWeight:400,
              letterSpacing: '0.2em', textTransform: 'uppercase',
              color: ACCENT, marginBottom: 14,
            }}>
              Planes
            </p>
            <h1 style={{
              fontFamily: font,
              fontSize: 'clamp(28px, 4vw, 36px)', fontWeight:400,
              color: WHITE, lineHeight: 1.1, marginBottom: 20,
            }}>
              Elige tu nivel
            </h1>
            <div style={{
              width: 40, height: 1, margin: '0 auto',
              background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`,
            }} />
            {activeTierSlugs.has('elite') && (
              <div style={{ marginTop: 22 }}>
                <EliteQuota variant="banner" copy="short" />
              </div>
            )}
          </div>

          <div className="tr-fade tr-desktop-table tr-table-wrap" style={{ animationDelay: '.12s', marginBottom: 2 }}>
            <table style={{
              width: '100%', minWidth: 640, borderCollapse: 'collapse',
              fontFamily: font,
            }}>
              <thead>
                <tr>
                  <th style={{ width: 160, padding: '16px 12px', textAlign: 'left', verticalAlign: 'bottom', background: BG }} />
                  {visibleIndexes.map((origI, displayIdx) => {
                    const isTop = displayIdx === 0
                    return (
                      <th key={TIER_SLUGS[origI]} style={{
                        padding: '20px 16px 16px', textAlign: 'center', verticalAlign: 'bottom',
                        background: isTop ? 'rgba(37, 99, 235,0.10)' : BG,
                      }}>
                        <p style={{
                          fontFamily: font, fontSize: 11, fontWeight:400,
                          letterSpacing: '0.2em', textTransform: 'uppercase',
                          color: ACCENT, marginBottom: 6,
                        }}>
                          {tierLevelLabel(displayIdx, visibleIndexes.length)}
                        </p>
                        <p style={{
                          fontFamily: font, fontSize: 22, fontWeight:400,
                          color: isTop ? ACCENT : WHITE,
                        }}>
                          {TIER_NAMES[origI]}
                        </p>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleFeatures.map((feat, ri) => {
                  const even = ri % 2 === 0
                  const bgBase = even ? 'var(--v-bg-card)' : BG
                  const bgTop  = even ? 'rgba(37, 99, 235,0.06)' : 'rgba(37, 99, 235,0.10)'
                  return (
                    <tr key={feat.label}>
                      <td style={{
                        padding: '12px 12px', background: bgBase,
                        borderBottom: `1px solid rgba(37, 99, 235,0.1)`,
                      }}>
                        <span style={{ fontFamily: font, fontSize: 15, color: WHITE }}>
                          {feat.label}
                        </span>
                      </td>
                      {visibleIndexes.map((origI, displayIdx) => {
                        const isTop = displayIdx === 0
                        return (
                          <td key={TIER_SLUGS[origI]} style={{
                            padding: '12px 16px', textAlign: 'center',
                            background: isTop ? bgTop : bgBase,
                            borderLeft: isTop ? `1px solid rgba(37, 99, 235,0.15)` : 'none',
                            borderBottom: `1px solid rgba(37, 99, 235,0.1)`,
                          }}>
                            {renderValue(feat.values[origI], isTop)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div
            className="tr-fade tr-desktop-prices"
            style={{
              animationDelay: '.18s', marginBottom: 72,
              gridTemplateColumns: `repeat(${visibleIndexes.length}, 1fr)`,
            }}
          >
            {visibleIndexes.map((origI, displayIdx) => {
              const p = PRICES[origI]
              const isTop = displayIdx === 0
              return (
                <div key={p.name} style={{
                  padding: '24px 16px', textAlign: 'center',
                  background: isTop ? 'rgba(37, 99, 235,0.10)' : 'var(--v-bg-card)',
                  borderTop: `1px solid rgba(37, 99, 235,0.15)`,
                }}>
                  <p style={{
                    fontFamily: font, fontSize: 11, fontWeight:400,
                    letterSpacing: '0.2em', textTransform: 'uppercase',
                    color: ACCENT, marginBottom: 8,
                  }}>
                    {p.name}
                  </p>
                  <p style={{
                    fontFamily: font, fontSize: 32, fontWeight:600,
                    letterSpacing: '-.02em',
                    fontVariantNumeric: 'tabular-nums',
                    color: isTop ? ACCENT : WHITE,
                  }}>
                    {p.num} <span style={{ fontSize: 16 }}>{p.unit}</span>
                  </p>
                  <p style={{
                    fontFamily: font, fontSize: 12, fontWeight:400,
                    color: ACCENT, marginTop: 4,
                  }}>
                    {p.period}
                  </p>
                </div>
              )
            })}
          </div>

          <div className="tr-fade tr-mobile-cards" style={{ animationDelay: '.12s', marginBottom: 56 }}>
            {visibleIndexes.map((origI, displayIdx) => {
              const name      = TIER_NAMES[origI]
              const slug      = TIER_SLUGS[origI]
              const isTop     = displayIdx === 0
              const isPremium = name === 'Basic'
              const price     = PRICES[origI]
              return (
                <div key={slug}>
                <div style={{
                  background: isTop ? 'rgba(37, 99, 235,0.06)' : 'var(--v-bg-card)',
                  border: isTop ? `1px solid ${ACCENT}` : `1px solid rgba(37, 99, 235,0.12)`,
                  borderRadius: 6,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '20px 20px 16px',
                    borderBottom: `1px solid rgba(37, 99, 235,0.1)`,
                    textAlign: 'center',
                  }}>
                    <p style={{
                      fontFamily: font, fontSize: 11, fontWeight:400,
                      letterSpacing: '0.2em', textTransform: 'uppercase',
                      color: ACCENT, marginBottom: 6,
                    }}>
                      {tierLevelLabel(displayIdx, visibleIndexes.length)}
                    </p>
                    <p style={{
                      fontFamily: font, fontSize: 28, fontWeight:400,
                      color: isTop ? ACCENT : WHITE,
                    }}>
                      {name}
                    </p>
                  </div>

                  <div style={{ padding: '0' }}>
                    {visibleFeatures.map((feat, fi) => (
                      <div key={feat.label} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '12px 20px',
                        borderBottom: fi < visibleFeatures.length - 1 ? `1px solid rgba(37, 99, 235,0.08)` : 'none',
                      }}>
                        <span style={{ fontFamily: font, fontSize: 15, color: WHITE }}>
                          {feat.label}
                        </span>
                        <span style={{ fontFamily: font, fontSize: 15 }}>
                          {renderValue(feat.values[origI], isTop)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div style={{
                    padding: '20px', textAlign: 'center',
                    borderTop: `1px solid rgba(37, 99, 235,0.1)`,
                    background: isTop ? 'rgba(37, 99, 235,0.04)' : 'transparent',
                  }}>
                    <p style={{
                      fontFamily: font, fontSize: 32, fontWeight:600,
                      letterSpacing: '-.02em',
                      fontVariantNumeric: 'tabular-nums',
                      color: isTop ? ACCENT : WHITE,
                    }}>
                      {price.num} <span style={{ fontSize: 16 }}>{price.unit}</span>
                    </p>
                    <p style={{
                      fontFamily: font, fontSize: 12, fontWeight:400,
                      color: ACCENT, marginTop: 4,
                    }}>
                      {price.period}
                    </p>
                  </div>
                </div>
                {isPremium && (
                  <p style={{
                    marginTop: 12, marginBottom: 4,
                    fontFamily: font, fontSize: 11, fontWeight: 400,
                    letterSpacing: '.04em', lineHeight: 1.7, fontStyle: 'italic',
                    color: 'var(--v-text-tertiary)',
                  }}>
                    No nos olvidamos de ti, profesional ✨
                  </p>
                )}
                </div>
              )
            })}
          </div>

          <div className="tr-fade" style={{ animationDelay: '.25s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 28 }}>
              <h2 style={{
                fontFamily: font, fontSize: 11, fontWeight: 400,
                letterSpacing: '.22em', textTransform: 'uppercase',
                color: ACCENT, whiteSpace: 'nowrap',
              }}>
                Glosario de beneficios
              </h2>
              <div style={{
                flex: 1, height: 1,
                background: `linear-gradient(90deg, rgba(37, 99, 235,0.3), transparent)`,
              }} />
            </div>

            <div className="gl-grid">
              {visibleGlossary.map((item, idx) => {
                const isOpen = openGlossary === idx
                const badge = BADGE_STYLES[item.badge]
                return (
                  <div key={item.term} style={{
                    background: isOpen ? 'rgba(37, 99, 235,0.06)' : 'var(--v-bg-card)',
                    borderLeft: isOpen ? `2px solid ${ACCENT}` : '2px solid transparent',
                    transition: 'background .3s ease, border-color .3s ease',
                  }}>
                    <button
                      onClick={() => setOpenGlossary(isOpen ? null : idx)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', padding: '14px 16px',
                        background: 'none', border: 'none', cursor: 'pointer',
                      }}
                    >
                      <span style={{
                        fontFamily: font, fontSize: 14, fontWeight:400,
                        letterSpacing: '0.1em', textTransform: 'uppercase',
                        color: ACCENT,
                      }}>
                        {item.term}
                      </span>
                      <span className={`gl-arrow${isOpen ? ' open' : ''}`} style={{
                        fontSize: 14, color: ACCENT,
                      }}>
                        &#x203a;
                      </span>
                    </button>
                    <div className={`gl-body${isOpen ? ' open' : ''}`}>
                      <div style={{ padding: '0 16px 16px' }}>
                        <p style={{
                          fontFamily: font, fontSize: 14, fontWeight:400,
                          color: 'var(--v-text-secondary)', lineHeight: 1.7,
                          marginBottom: 12,
                        }}>
                          {item.desc}
                        </p>
                        <span style={{
                          display: 'inline-block',
                          fontFamily: font, fontSize: 11, fontWeight:400,
                          letterSpacing: '0.1em', textTransform: 'uppercase',
                          color: ACCENT, background: badge.bg,
                          border: badge.border,
                          padding: '3px 10px', borderRadius: 6,
                        }}>
                          {badge.label}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="tr-fade" style={{ animationDelay: '.3s' }}>
            <EliteBenefit marginTop={48} />
          </div>

        </div>

      </main>
    </>
  )
}
