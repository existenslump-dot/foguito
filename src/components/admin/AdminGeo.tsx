'use client'

/**
 * Admin geo CRUD — manage country / provincia / comuna / barrio.
 *
 * Three-column layout: pick a provincia to see its comunas, pick a comuna
 * to see its barrios. Each column supports:
 *   - Add new (prompt modal)
 *   - Toggle active (soft-delete — keeps FK refs intact)
 *
 * Edit and hard-delete are intentionally out of scope: active=false hides
 * the entity from public selectors without breaking posts that reference
 * it. Use SQL Editor for rename / merge operations.
 *
 * Posts created against an inactive geo entity keep their FK — only the
 * UI stops offering it as an option.
 *
 * Tailwind migration: inline styles → utilities. Subcomponents (Column,
 * Row) also migrated. The cascade-loop eslint-disable comments stay — the
 * pattern is legitimate external-sync and React Compiler doesn't know.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useMarketplaceDialog } from '@/components/ui/MarketplaceDialog'
import type { Country, Provincia, Comuna, Barrio } from '@/lib/geo'
import {
  fetchActiveCountries,
  fetchProvincias,
  fetchComunas,
  fetchBarrios,
} from '@/lib/geo'

interface Props {
  notify: (text: string, type: 'success' | 'error') => void
}

const MONO = { fontFamily: "'Montserrat',sans-serif" } as const

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function AdminGeo({ notify }: Props) {
  const dlg = useMarketplaceDialog()

  const [countries, setCountries] = useState<Country[]>([])
  const [countryId, setCountryId] = useState<string | null>(null)

  // Lists + selections (null selection = nothing picked in that column).
  const [provincias,    setProvincias]    = useState<Provincia[]>([])
  const [provinciaId,   setProvinciaId]   = useState<string | null>(null)
  const [comunas,       setComunas]       = useState<Comuna[]>([])
  const [comunaId,      setComunaId]      = useState<string | null>(null)
  const [barrios,       setBarrios]       = useState<Barrio[]>([])

  // ── Initial fetch — countries, default to Argentina ──────────────────
  useEffect(() => {
    ;(async () => {
      const list = await fetchActiveCountries(supabase)
      setCountries(list)
      const ar = list.find(c => c.slug === 'argentina')
      if (ar) setCountryId(ar.id)
    })()
  }, [])

  // ── Cascading refetches ──────────────────────────────────────────────
  // Each effect clears the next-level list + id when its parent changes.
  // Same legitimate external-sync pattern as useGeoCascade — the Compiler
  // flags it as a cascade loop, but the reset only fires when the parent
  // id turns null, so there's no runaway.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!countryId) { setProvincias([]); return }
    fetchProvincias(supabase, countryId).then(setProvincias)
    setProvinciaId(null); setComunaId(null)
  }, [countryId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!provinciaId) { setComunas([]); return }
    fetchComunas(supabase, provinciaId).then(setComunas)
    setComunaId(null)
  }, [provinciaId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!comunaId) { setBarrios([]); return }
    fetchBarrios(supabase, comunaId).then(setBarrios)
  }, [comunaId])

  // ── Refetch the current column after a mutation ─────────────────────
  async function refetchProvincias() {
    if (!countryId) return
    setProvincias(await fetchProvincias(supabase, countryId))
  }
  async function refetchComunas() {
    if (!provinciaId) return
    setComunas(await fetchComunas(supabase, provinciaId))
  }
  async function refetchBarrios() {
    if (!comunaId) return
    setBarrios(await fetchBarrios(supabase, comunaId))
  }

  // ── Add actions ──────────────────────────────────────────────────────
  async function addProvincia() {
    if (!countryId) return
    const name = await dlg.prompt('Nombre de la provincia:', {
      title: 'Nueva provincia',
      placeholder: 'Ej. Córdoba',
      confirmLabel: 'Crear',
    })
    if (!name?.trim()) return
    const { error } = await supabase.from('provincias').insert({
      country_id: countryId,
      slug: slugify(name),
      name: name.trim(),
      sort_order: provincias.length + 1,
    })
    if (error) { notify('Error: ' + error.message, 'error'); return }
    notify('Provincia creada', 'success')
    refetchProvincias()
  }

  async function addComuna() {
    if (!provinciaId) return
    const name = await dlg.prompt('Nombre de la comuna / localidad:', {
      title: 'Nueva comuna',
      placeholder: 'Ej. Mar del Plata',
      confirmLabel: 'Crear',
    })
    if (!name?.trim()) return
    const { error } = await supabase.from('comunas').insert({
      provincia_id: provinciaId,
      slug: slugify(name),
      name: name.trim(),
      sort_order: comunas.length + 1,
    })
    if (error) { notify('Error: ' + error.message, 'error'); return }
    notify('Comuna creada', 'success')
    refetchComunas()
  }

  async function addBarrio() {
    if (!comunaId) return
    const name = await dlg.prompt('Nombre del barrio:', {
      title: 'Nuevo barrio',
      placeholder: 'Ej. Don Torcuato',
      confirmLabel: 'Crear',
    })
    if (!name?.trim()) return
    const { error } = await supabase.from('barrios').insert({
      comuna_id: comunaId,
      slug: slugify(name),
      name: name.trim(),
      sort_order: barrios.length + 1,
    })
    if (error) { notify('Error: ' + error.message, 'error'); return }
    notify('Barrio creado', 'success')
    refetchBarrios()
  }

  // ── Toggle active (soft-delete) ──────────────────────────────────────
  async function toggleActive(
    table: 'provincias' | 'comunas' | 'barrios',
    id: string,
    current: boolean,
    refetch: () => Promise<void>,
  ) {
    const { error } = await supabase.from(table).update({ active: !current }).eq('id', id)
    if (error) { notify('Error: ' + error.message, 'error'); return }
    notify(!current ? 'Activado' : 'Ocultado del listado', 'success')
    await refetch()
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <>
      {dlg.dialog}
      <div className="adm-card">
        <div className="adm-card-head">
          <h3>Geografía</h3>
          <span className="adm-card-ct" style={MONO}>
            <b style={{ color: 'var(--v-accent)' }}>{provincias.filter(p => p.active).length}</b> provincias ·{' '}
            <b style={{ color: 'var(--v-accent)' }}>{comunas.filter(c => c.active).length}</b> comunas ·{' '}
            <b style={{ color: 'var(--v-accent)' }}>{barrios.filter(b => b.active).length}</b> barrios
          </span>
        </div>
        <div className="p-5">

        {/* Country selector */}
        <div className="mb-5">
          <label className="v-label block mb-1.5">País</label>
          <select
            value={countryId ?? ''}
            onChange={e => setCountryId(e.target.value || null)}
            className="v-select max-w-[280px]"
          >
            {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* 3-column layout */}
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">

          {/* ── Provincias ── */}
          <Column
            title="Provincias"
            subtitle={`${provincias.length} total`}
            onAdd={countryId ? addProvincia : undefined}
            addLabel="+ Agregar provincia"
          >
            {provincias.map(p => (
              <Row
                key={p.id}
                name={p.name}
                slug={p.slug}
                active={p.active}
                selected={provinciaId === p.id}
                onClick={() => setProvinciaId(p.id)}
                onToggle={() => toggleActive('provincias', p.id, p.active, refetchProvincias)}
              />
            ))}
          </Column>

          {/* ── Comunas ── */}
          <Column
            title="Comunas / Localidades"
            subtitle={provinciaId ? `${comunas.length} total` : 'Selecciona una provincia'}
            onAdd={provinciaId ? addComuna : undefined}
            addLabel="+ Agregar comuna"
            disabled={!provinciaId}
          >
            {comunas.map(c => (
              <Row
                key={c.id}
                name={c.name}
                slug={c.slug}
                active={c.active}
                selected={comunaId === c.id}
                onClick={() => setComunaId(c.id)}
                onToggle={() => toggleActive('comunas', c.id, c.active, refetchComunas)}
              />
            ))}
          </Column>

          {/* ── Barrios ── */}
          <Column
            title="Barrios"
            subtitle={comunaId ? `${barrios.length} total` : 'Selecciona una comuna'}
            onAdd={comunaId ? addBarrio : undefined}
            addLabel="+ Agregar barrio"
            disabled={!comunaId}
          >
            {barrios.map(b => (
              <Row
                key={b.id}
                name={b.name}
                slug={b.slug}
                active={b.active}
                selected={false}
                onClick={() => {}}
                onToggle={() => toggleActive('barrios', b.id, b.active, refetchBarrios)}
              />
            ))}
          </Column>
        </div>
        </div>{/* /.p-5 */}
      </div>{/* /.adm-card */}
    </>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function Column({
  title, subtitle, onAdd, addLabel, disabled, children,
}: {
  title: string
  subtitle: string
  onAdd?: () => void
  addLabel: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`bg-white/5 border border-white/5 rounded-[2px] p-4 ${disabled ? 'opacity-40' : 'opacity-100'}`}
    >
      <div className="flex justify-between items-baseline mb-3">
        <div>
          <p className="text-[9px] font-semibold tracking-[.22em] uppercase text-[var(--v-accent)]" style={MONO}>{title}</p>
          <p className="text-[8px] font-normal text-[var(--v-text-tertiary)] mt-1" style={MONO}>{subtitle}</p>
        </div>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="v-admin-btn text-[7px] px-2.5 py-1 text-[var(--v-accent)] border-[var(--v-accent)]/30"
          >
            {addLabel}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1 max-h-[320px] overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

function Row({
  name, slug, active, selected, onClick, onToggle,
}: {
  name: string
  slug: string
  active: boolean
  selected: boolean
  onClick: () => void
  onToggle: () => void
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-2 rounded-[2px] cursor-pointer border ${
        selected
          ? 'bg-[var(--v-accent)]/15 border-[var(--v-accent)]/40'
          : 'bg-transparent border-white/5'
      } ${active ? 'opacity-100' : 'opacity-50'}`}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-normal text-[var(--v-text-primary)] whitespace-nowrap overflow-hidden text-ellipsis">
          {name}
        </p>
        <p className="text-[8px] font-normal text-[var(--v-text-tertiary)] tracking-[.08em] mt-0.5" style={MONO}>
          {slug}
        </p>
      </div>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onToggle() }}
        title={active ? 'Ocultar del listado' : 'Reactivar'}
        className={`text-[7px] font-medium tracking-[.18em] uppercase px-2 py-1 rounded-[2px] bg-transparent border cursor-pointer flex-shrink-0 ${
          active
            ? 'border-white/10 text-[var(--v-text-tertiary)]'
            : 'border-[rgba(90,160,90,0.4)] text-[#90c990]'
        }`}
        style={MONO}
      >
        {active ? 'Activo' : 'Oculto'}
      </button>
    </div>
  )
}
