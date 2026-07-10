'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'

type AuditRow = {
  id: string
  created_at: string
  actor_user_id: string | null
  actor_role: 'anonymous' | 'user' | 'admin'
  event_type: string
  subject_type: string | null
  subject_id: string | null
  ip: string | null
  user_agent: string | null
  metadata: Record<string, unknown> | null
}

type ProfileLookup = {
  id: string
  email: string
  full_name: string | null
}

const PAGE_SIZE = 50

const KNOWN_EVENTS = [
  'signup',
  'kyc_submitted',
  'kyc_approved',
  'kyc_rejected',
  'post_created',
  'post_edited',
  'post_approved',
  'post_rejected',
  'post_deleted',
  'report_received',
] as const

const KNOWN_SUBJECT_TYPES = ['profile', 'post', 'report', 'verification'] as const

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [actorMap, setActorMap] = useState<Record<string, ProfileLookup>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const [filterEventType, setFilterEventType] = useState<string>('')
  const [filterActorRole, setFilterActorRole] = useState<string>('')
  const [filterSubjectType, setFilterSubjectType] = useState<string>('')
  const [filterSubjectId, setFilterSubjectId] = useState<string>('')
  const [filterActorId, setFilterActorId] = useState<string>('')
  const [filterIp, setFilterIp] = useState<string>('')
  const [filterDateFrom, setFilterDateFrom] = useState<string>('')
  const [filterDateTo, setFilterDateTo] = useState<string>('')

  const fetchPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('audit_log')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

      if (filterEventType)   query = query.eq('event_type', filterEventType)
      if (filterActorRole)   query = query.eq('actor_role', filterActorRole)
      if (filterSubjectType) query = query.eq('subject_type', filterSubjectType)
      if (filterSubjectId)   query = query.eq('subject_id', filterSubjectId)
      if (filterActorId)     query = query.eq('actor_user_id', filterActorId)
      if (filterIp)          query = query.eq('ip', filterIp)
      if (filterDateFrom)    query = query.gte('created_at', filterDateFrom)
      if (filterDateTo)      query = query.lte('created_at', filterDateTo)

      const { data, count, error: fetchErr } = await query
      if (fetchErr) throw new Error(fetchErr.message)

      const rowsTyped = (data as AuditRow[]) ?? []
      setRows(rowsTyped)
      setTotalCount(count ?? null)

      const actorIds = Array.from(new Set(rowsTyped.map(r => r.actor_user_id).filter(Boolean))) as string[]
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', actorIds)
        if (profiles) {
          const next: Record<string, ProfileLookup> = {}
          for (const p of profiles) next[p.id] = p as ProfileLookup
          setActorMap(prev => ({ ...prev, ...next }))
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [page, filterEventType, filterActorRole, filterSubjectType, filterSubjectId, filterActorId, filterIp, filterDateFrom, filterDateTo])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchPage() }, [fetchPage])

  useEffect(() => { setPage(0) }, [filterEventType, filterActorRole, filterSubjectType, filterSubjectId, filterActorId, filterIp, filterDateFrom, filterDateTo])

  function clearFilters() {
    setFilterEventType('')
    setFilterActorRole('')
    setFilterSubjectType('')
    setFilterSubjectId('')
    setFilterActorId('')
    setFilterIp('')
    setFilterDateFrom('')
    setFilterDateTo('')
  }

  function formatActor(r: AuditRow): string {
    if (!r.actor_user_id) return 'anónimo'
    const lookup = actorMap[r.actor_user_id]
    if (!lookup) return r.actor_user_id.slice(0, 8) + '…'
    return lookup.full_name || lookup.email
  }

  function formatDate(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'medium' })
  }

  function eventColor(eventType: string): string {
    if (eventType.includes('approved')) return 'var(--v-success)'
    if (eventType.includes('rejected') || eventType.includes('deleted')) return 'var(--v-error)'
    if (eventType.includes('submitted') || eventType.includes('refreshed')) return 'var(--v-accent)'
    if (eventType.includes('report')) return '#C56A6A'
    return 'var(--v-text-tertiary)'
  }

  return (
    <div className="min-h-screen bg-[var(--v-bg-base)] text-white p-6">
      <div className="max-w-[1400px] mx-auto">
        <header className="mb-8 flex flex-wrap justify-between items-end gap-4">
          <div>
            <p className="font-['Montserrat',sans-serif] text-[9px] tracking-[.22em] uppercase text-[var(--v-accent)] mb-2">
              Compliance / Forense
            </p>
            <h1 className="font-['Switzer',sans-serif] text-3xl font-normal text-white/95">
              Audit log
            </h1>
            <p className="font-['Montserrat',sans-serif] text-xs text-white/40 mt-1">
              Tabla append-only de eventos de la plataforma. Solo admin SELECT.
            </p>
          </div>
          <Link
            href="/admin"
            className="font-['Montserrat',sans-serif] text-[9px] tracking-[.2em] uppercase text-white/50 hover:text-[var(--v-accent)] no-underline border border-white/10 rounded-[6px] px-4 py-2"
          >
            ← Volver al admin
          </Link>
        </header>

        <div className="bg-[var(--v-bg-card)] border border-white/5 rounded-[6px] p-5 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <label className="block">
              <span className="block font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/40 mb-1.5">
                Event type
              </span>
              <select
                value={filterEventType}
                onChange={e => setFilterEventType(e.target.value)}
                className="w-full bg-[var(--v-bg-base)] border border-white/10 rounded-[4px] px-3 py-2 text-white text-sm"
              >
                <option value="">Cualquiera</option>
                {KNOWN_EVENTS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="block font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/40 mb-1.5">
                Actor role
              </span>
              <select
                value={filterActorRole}
                onChange={e => setFilterActorRole(e.target.value)}
                className="w-full bg-[var(--v-bg-base)] border border-white/10 rounded-[4px] px-3 py-2 text-white text-sm"
              >
                <option value="">Cualquiera</option>
                <option value="anonymous">anonymous</option>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </label>

            <label className="block">
              <span className="block font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/40 mb-1.5">
                Subject type
              </span>
              <select
                value={filterSubjectType}
                onChange={e => setFilterSubjectType(e.target.value)}
                className="w-full bg-[var(--v-bg-base)] border border-white/10 rounded-[4px] px-3 py-2 text-white text-sm"
              >
                <option value="">Cualquiera</option>
                {KNOWN_SUBJECT_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="block font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/40 mb-1.5">
                Subject ID (UUID)
              </span>
              <input
                type="text"
                value={filterSubjectId}
                onChange={e => setFilterSubjectId(e.target.value.trim())}
                placeholder="post id, profile id, …"
                className="w-full bg-[var(--v-bg-base)] border border-white/10 rounded-[4px] px-3 py-2 text-white text-sm font-mono"
              />
            </label>

            <label className="block">
              <span className="block font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/40 mb-1.5">
                Actor user ID (UUID)
              </span>
              <input
                type="text"
                value={filterActorId}
                onChange={e => setFilterActorId(e.target.value.trim())}
                placeholder="user id"
                className="w-full bg-[var(--v-bg-base)] border border-white/10 rounded-[4px] px-3 py-2 text-white text-sm font-mono"
              />
            </label>

            <label className="block">
              <span className="block font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/40 mb-1.5">
                IP
              </span>
              <input
                type="text"
                value={filterIp}
                onChange={e => setFilterIp(e.target.value.trim())}
                placeholder="ej. 200.45.x.x"
                className="w-full bg-[var(--v-bg-base)] border border-white/10 rounded-[4px] px-3 py-2 text-white text-sm font-mono"
              />
            </label>

            <label className="block">
              <span className="block font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/40 mb-1.5">
                Desde
              </span>
              <input
                type="datetime-local"
                value={filterDateFrom}
                onChange={e => setFilterDateFrom(e.target.value)}
                className="w-full bg-[var(--v-bg-base)] border border-white/10 rounded-[4px] px-3 py-2 text-white text-sm"
              />
            </label>

            <label className="block">
              <span className="block font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/40 mb-1.5">
                Hasta
              </span>
              <input
                type="datetime-local"
                value={filterDateTo}
                onChange={e => setFilterDateTo(e.target.value)}
                className="w-full bg-[var(--v-bg-base)] border border-white/10 rounded-[4px] px-3 py-2 text-white text-sm"
              />
            </label>
          </div>

          <div className="mt-4 flex justify-between items-center">
            <p className="font-['Montserrat',sans-serif] text-[10px] text-white/40">
              {loading
                ? 'Cargando…'
                : totalCount !== null
                  ? `${totalCount} eventos · página ${page + 1}/${Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}`
                  : `${rows.length} eventos en página actual`}
            </p>
            <button
              type="button"
              onClick={clearFilters}
              className="font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/50 hover:text-[var(--v-accent)] bg-transparent border border-white/10 rounded-[4px] px-3 py-1.5 cursor-pointer"
            >
              Limpiar filtros
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-[rgba(224,85,85,0.06)] border border-[rgba(224,85,85,0.3)] rounded-[6px] p-4 mb-6">
            <p className="font-['Montserrat',sans-serif] text-sm text-[var(--v-error)]">{error}</p>
          </div>
        )}

        <div className="bg-[var(--v-bg-card)] border border-white/5 rounded-[6px] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left px-4 py-3 font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/50">Fecha</th>
                <th className="text-left px-4 py-3 font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/50">Actor</th>
                <th className="text-left px-4 py-3 font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/50">Rol</th>
                <th className="text-left px-4 py-3 font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/50">Evento</th>
                <th className="text-left px-4 py-3 font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/50">Subject</th>
                <th className="text-left px-4 py-3 font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/50">IP</th>
                <th className="text-left px-4 py-3 font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/50">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-white/40 text-sm">
                    {error ? 'Error cargando' : 'Sin resultados para estos filtros'}
                  </td>
                </tr>
              )}
              {rows.map(r => {
                const expanded = expandedRow === r.id
                const hasMetadata = r.metadata && Object.keys(r.metadata).length > 0
                return (
                  <Fragment key={r.id}>
                    <tr className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-white/70 font-mono text-xs whitespace-nowrap">{formatDate(r.created_at)}</td>
                      <td className="px-4 py-3 text-white/85 text-sm">{formatActor(r)}</td>
                      <td className="px-4 py-3">
                        <span
                          className="font-['Montserrat',sans-serif] text-[8px] tracking-[.18em] uppercase px-2 py-1 rounded-[4px]"
                          style={{
                            color: r.actor_role === 'admin' ? 'var(--v-accent)' : r.actor_role === 'user' ? 'var(--v-success)' : 'var(--v-text-tertiary)',
                            background:
                              r.actor_role === 'admin' ? 'rgba(37, 99, 235,0.08)'
                              : r.actor_role === 'user' ? 'rgba(106,176,106,0.08)'
                              : 'rgba(120,112,104,0.08)',
                          }}
                        >
                          {r.actor_role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="font-['Montserrat',sans-serif] text-[10px] tracking-[.04em]"
                          style={{ color: eventColor(r.event_type) }}
                        >
                          {r.event_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/60 font-mono text-xs">
                        {r.subject_type
                          ? (<><span className="text-white/80">{r.subject_type}</span>{r.subject_id ? <> · <span title={r.subject_id}>{r.subject_id.slice(0, 8)}…</span></> : null}</>)
                          : <span className="text-white/30">—</span>}
                      </td>
                      <td className="px-4 py-3 text-white/60 font-mono text-xs">{r.ip ?? <span className="text-white/30">—</span>}</td>
                      <td className="px-4 py-3">
                        {hasMetadata ? (
                          <button
                            type="button"
                            onClick={() => setExpandedRow(expanded ? null : r.id)}
                            className="font-['Montserrat',sans-serif] text-[9px] tracking-[.16em] uppercase text-[var(--v-accent)] hover:text-[var(--v-accent-light)] bg-transparent border-none cursor-pointer p-0"
                          >
                            {expanded ? '▼ ocultar' : '▶ ver'}
                          </button>
                        ) : (
                          <span className="text-white/30 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                    {expanded && hasMetadata && (
                      <tr>
                        <td colSpan={7} className="px-4 py-3 bg-[var(--v-bg-base)] border-b border-white/5">
                          <pre className="font-mono text-[11px] text-white/70 whitespace-pre-wrap break-all overflow-x-auto">
                            {JSON.stringify(r.metadata, null, 2)}
                          </pre>
                          {r.user_agent && (
                            <p className="font-['Montserrat',sans-serif] text-[10px] text-white/40 mt-2">
                              <span className="text-white/60">user-agent:</span> {r.user_agent}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {totalCount !== null && totalCount > PAGE_SIZE && (
          <div className="mt-6 flex justify-center items-center gap-3">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="font-['Montserrat',sans-serif] text-[10px] tracking-[.18em] uppercase text-white/70 hover:text-[var(--v-accent)] disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border border-white/10 rounded-[4px] px-4 py-2 cursor-pointer"
            >
              ← Anterior
            </button>
            <span className="font-['Montserrat',sans-serif] text-[10px] text-white/50">
              {page + 1} / {Math.ceil(totalCount / PAGE_SIZE)}
            </span>
            <button
              type="button"
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * PAGE_SIZE >= totalCount || loading}
              className="font-['Montserrat',sans-serif] text-[10px] tracking-[.18em] uppercase text-white/70 hover:text-[var(--v-accent)] disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border border-white/10 rounded-[4px] px-4 py-2 cursor-pointer"
            >
              Siguiente →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
