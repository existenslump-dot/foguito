'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'

const RECENT_POSTS_LIMIT = 1000
const RECENT_SIGNUPS_DAYS = 30
const RECENT_REPORTS_HOURS = 24
const PHONE_THRESHOLD = 2
const SIGNUP_IP_THRESHOLD = 3
const REPORT_IP_THRESHOLD = 5

type PhoneGroup = {
  phone: string
  count: number
  posts: { id: string; title: string | null; user_id: string | null; status: string | null; created_at: string }[]
  uniqueUserIds: number
}

type SignupIpGroup = {
  ip: string
  count: number
  users: { id: string; email: string; full_name: string | null; signup_at: string; verification_status: string | null }[]
}

type ReportIpGroup = {
  ip: string
  count: number
  reports: { id: string; post_id: string; category: string; created_at: string; status: string | null }[]
}

export default function PatternsPage() {
  const [phoneGroups, setPhoneGroups] = useState<PhoneGroup[]>([])
  const [signupIpGroups, setSignupIpGroups] = useState<SignupIpGroup[]>([])
  const [reportIpGroups, setReportIpGroups] = useState<ReportIpGroup[]>([])
  const [loadingPhones, setLoadingPhones] = useState(true)
  const [loadingSignups, setLoadingSignups] = useState(true)
  const [loadingReports, setLoadingReports] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const loadPhones = useCallback(async () => {
    setLoadingPhones(true)
    try {
      const { data, error: fetchErr } = await supabase
        .from('posts')
        .select('id, title, user_id, status, created_at, whatsapp_number')
        .not('whatsapp_number', 'is', null)
        .order('created_at', { ascending: false })
        .limit(RECENT_POSTS_LIMIT)
      if (fetchErr) throw new Error(fetchErr.message)

      const grouped = new Map<string, PhoneGroup>()
      for (const p of (data ?? [])) {
        const phoneRaw = (p as { whatsapp_number?: string }).whatsapp_number
        if (!phoneRaw) continue
        const phone = phoneRaw.trim()
        if (!phone) continue
        let g = grouped.get(phone)
        if (!g) {
          g = { phone, count: 0, posts: [], uniqueUserIds: 0 }
          grouped.set(phone, g)
        }
        g.count++
        g.posts.push({
          id: p.id,
          title: (p as { title?: string }).title ?? null,
          user_id: (p as { user_id?: string }).user_id ?? null,
          status: (p as { status?: string }).status ?? null,
          created_at: (p as { created_at: string }).created_at,
        })
      }
      const filtered: PhoneGroup[] = []
      for (const g of grouped.values()) {
        if (g.count < PHONE_THRESHOLD) continue
        g.uniqueUserIds = new Set(g.posts.map(p => p.user_id).filter(Boolean)).size
        filtered.push(g)
      }
      filtered.sort((a, b) => b.count - a.count)
      setPhoneGroups(filtered.slice(0, 50))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading phones')
    } finally {
      setLoadingPhones(false)
    }
  }, [])

  const loadSignupIps = useCallback(async () => {
    setLoadingSignups(true)
    try {
      const cutoff = new Date(Date.now() - RECENT_SIGNUPS_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data, error: fetchErr } = await supabase
        .from('profiles')
        .select('id, email, full_name, created_at, registration_ip, verification_status')
        .not('registration_ip', 'is', null)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(RECENT_POSTS_LIMIT)
      if (fetchErr) throw new Error(fetchErr.message)

      const grouped = new Map<string, SignupIpGroup>()
      for (const p of (data ?? [])) {
        const ipRaw = (p as { registration_ip?: string }).registration_ip
        if (!ipRaw) continue
        const ip = ipRaw.trim()
        if (!ip || ip === 'unknown') continue
        let g = grouped.get(ip)
        if (!g) { g = { ip, count: 0, users: [] }; grouped.set(ip, g) }
        g.count++
        g.users.push({
          id: p.id,
          email: (p as { email: string }).email,
          full_name: (p as { full_name?: string }).full_name ?? null,
          signup_at: (p as { created_at: string }).created_at,
          verification_status: (p as { verification_status?: string }).verification_status ?? null,
        })
      }
      const filtered: SignupIpGroup[] = []
      for (const g of grouped.values()) {
        if (g.count < SIGNUP_IP_THRESHOLD) continue
        filtered.push(g)
      }
      filtered.sort((a, b) => b.count - a.count)
      setSignupIpGroups(filtered.slice(0, 50))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading signup IPs')
    } finally {
      setLoadingSignups(false)
    }
  }, [])

  const loadReportIps = useCallback(async () => {
    setLoadingReports(true)
    try {
      const cutoff = new Date(Date.now() - RECENT_REPORTS_HOURS * 60 * 60 * 1000).toISOString()
      const { data, error: fetchErr } = await supabase
        .from('reports')
        .select('id, post_id, category, created_at, status, reporter_ip')
        .not('reporter_ip', 'is', null)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(RECENT_POSTS_LIMIT)
      if (fetchErr) throw new Error(fetchErr.message)

      const grouped = new Map<string, ReportIpGroup>()
      for (const r of (data ?? [])) {
        const ipRaw = (r as { reporter_ip?: string }).reporter_ip
        if (!ipRaw) continue
        const ip = ipRaw.trim()
        if (!ip || ip === 'unknown') continue
        let g = grouped.get(ip)
        if (!g) { g = { ip, count: 0, reports: [] }; grouped.set(ip, g) }
        g.count++
        g.reports.push({
          id: r.id,
          post_id: (r as { post_id: string }).post_id,
          category: (r as { category: string }).category,
          created_at: (r as { created_at: string }).created_at,
          status: (r as { status?: string }).status ?? null,
        })
      }
      const filtered: ReportIpGroup[] = []
      for (const g of grouped.values()) {
        if (g.count < REPORT_IP_THRESHOLD) continue
        filtered.push(g)
      }
      filtered.sort((a, b) => b.count - a.count)
      setReportIpGroups(filtered.slice(0, 50))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading report IPs')
    } finally {
      setLoadingReports(false)
    }
  }, [])

  useEffect(() => {
    void loadPhones()
    void loadSignupIps()
    void loadReportIps()
  }, [loadPhones, loadSignupIps, loadReportIps])

  const refreshAll = () => {
    setError(null)
    void loadPhones()
    void loadSignupIps()
    void loadReportIps()
  }

  function severityColor(count: number, highThreshold: number): string {
    if (count >= highThreshold) return 'var(--v-error)'
    if (count >= highThreshold - 1) return '#C56A6A'
    return 'var(--v-accent)'
  }

  function formatDate(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
  }

  function toggleExpanded(key: string) {
    setExpandedKey(prev => prev === key ? null : key)
  }

  return (
    <div className="min-h-screen bg-[var(--v-bg-base)] text-white p-6">
      <div className="max-w-[1280px] mx-auto">
        <header className="mb-8 flex flex-wrap justify-between items-end gap-4">
          <div>
            <p className="font-['Montserrat',sans-serif] text-[9px] tracking-[.22em] uppercase text-[var(--v-accent)] mb-2">
              Detección proactiva
            </p>
            <h1 className="font-['Switzer',sans-serif] text-3xl font-normal text-white/95">
              Patrones sospechosos
            </h1>
            <p className="font-['Montserrat',sans-serif] text-xs text-white/40 mt-1">
              Queries on-demand contra posts / profiles / reports. Complementa los reports reactivos con señales que el admin puede investigar antes de que lleguen denuncias.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={refreshAll}
              className="font-['Montserrat',sans-serif] text-[9px] tracking-[.2em] uppercase text-[var(--v-accent)] hover:text-[var(--v-accent-light)] bg-transparent border border-[rgba(37,99,235,0.4)] rounded-[6px] px-4 py-2 cursor-pointer"
            >
              ↻ Recargar
            </button>
            <Link
              href="/admin"
              className="font-['Montserrat',sans-serif] text-[9px] tracking-[.2em] uppercase text-white/50 hover:text-[var(--v-accent)] no-underline border border-white/10 rounded-[6px] px-4 py-2"
            >
              ← Volver al admin
            </Link>
          </div>
        </header>

        {error && (
          <div className="bg-[rgba(224,85,85,0.06)] border border-[rgba(224,85,85,0.3)] rounded-[6px] p-4 mb-6">
            <p className="font-['Montserrat',sans-serif] text-sm text-[var(--v-error)]">{error}</p>
          </div>
        )}

        <section className="bg-[var(--v-bg-card)] border border-white/5 rounded-[6px] p-5 mb-6">
          <header className="flex flex-wrap justify-between items-baseline gap-2 mb-4">
            <div>
              <h2 className="font-['Switzer',sans-serif] text-xl font-normal text-[var(--v-accent)]">
                Phones duplicados en posts
              </h2>
              <p className="font-['Montserrat',sans-serif] text-[10px] text-white/40 mt-1">
                Threshold: ≥{PHONE_THRESHOLD} posts con mismo \`whatsapp_number\`. Puede indicar publicaciones duplicadas o un mismo operador con varias cuentas (revisar si count ≥3 + diferentes user_ids).
              </p>
            </div>
            <span className="font-['Montserrat',sans-serif] text-[10px] text-white/50">
              {loadingPhones ? 'cargando…' : `${phoneGroups.length} grupos`}
            </span>
          </header>
          {phoneGroups.length === 0 && !loadingPhones ? (
            <p className="text-[10px] text-white/40 font-['Montserrat',sans-serif]">Sin phones duplicados en los últimos {RECENT_POSTS_LIMIT} posts.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {phoneGroups.map(g => {
                const key = `phone-${g.phone}`
                const expanded = expandedKey === key
                const isCrossUser = g.uniqueUserIds > 1
                return (
                  <div key={key} className="border border-white/5 rounded-[6px]">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(key)}
                      className="w-full flex justify-between items-center px-4 py-3 bg-transparent border-none cursor-pointer text-left hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="font-['Montserrat',sans-serif] text-xs font-medium px-2 py-1 rounded-[4px]"
                          style={{ color: severityColor(g.count, 3), background: severityColor(g.count, 3) + '15', minWidth: '40px', textAlign: 'center' }}
                        >
                          ×{g.count}
                        </span>
                        <span className="font-mono text-sm text-white/85 truncate">{g.phone}</span>
                        {isCrossUser && (
                          <span className="font-['Montserrat',sans-serif] text-[8px] tracking-[.18em] uppercase px-2 py-1 rounded-[4px] text-[var(--v-error)] bg-[rgba(224,85,85,0.08)] border border-[rgba(224,85,85,0.3)]">
                            ⚠️ {g.uniqueUserIds} cuentas distintas
                          </span>
                        )}
                      </div>
                      <span className="font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/40">
                        {expanded ? '▼ ocultar' : '▶ ver posts'}
                      </span>
                    </button>
                    {expanded && (
                      <div className="border-t border-white/5 p-4 bg-[var(--v-bg-base)]">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-white/40 font-['Montserrat',sans-serif] uppercase text-[9px] tracking-[.16em]">
                              <th className="pb-2">Title</th>
                              <th className="pb-2">User ID</th>
                              <th className="pb-2">Status</th>
                              <th className="pb-2">Created</th>
                              <th className="pb-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.posts.map(p => (
                              <tr key={p.id} className="border-t border-white/5">
                                <td className="py-2 pr-2 text-white/80 truncate max-w-[200px]">{p.title || '(sin título)'}</td>
                                <td className="py-2 pr-2 font-mono text-white/55 text-[10px]">{p.user_id?.slice(0, 8) ?? '—'}…</td>
                                <td className="py-2 pr-2 text-white/60">{p.status || '—'}</td>
                                <td className="py-2 pr-2 text-white/50">{formatDate(p.created_at)}</td>
                                <td className="py-2">
                                  <Link
                                    href={`/admin/audit-log?subjectId=${p.id}`}
                                    className="font-['Montserrat',sans-serif] text-[9px] tracking-[.16em] uppercase text-[var(--v-accent)] no-underline"
                                  >
                                    Audit log
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="bg-[var(--v-bg-card)] border border-white/5 rounded-[6px] p-5 mb-6">
          <header className="flex flex-wrap justify-between items-baseline gap-2 mb-4">
            <div>
              <h2 className="font-['Switzer',sans-serif] text-xl font-normal text-[var(--v-accent)]">
                Signup IPs duplicados (últimos {RECENT_SIGNUPS_DAYS}d)
              </h2>
              <p className="font-['Montserrat',sans-serif] text-[10px] text-white/40 mt-1">
                Threshold: ≥{SIGNUP_IP_THRESHOLD} cuentas creadas desde la misma IP. Puede ser locutorio/hogar familiar (caso legítimo) o operador creando cuentas por sus víctimas (escalar si count ≥5).
              </p>
            </div>
            <span className="font-['Montserrat',sans-serif] text-[10px] text-white/50">
              {loadingSignups ? 'cargando…' : `${signupIpGroups.length} grupos`}
            </span>
          </header>
          {signupIpGroups.length === 0 && !loadingSignups ? (
            <p className="text-[10px] text-white/40 font-['Montserrat',sans-serif]">Sin signup IPs duplicados en los últimos {RECENT_SIGNUPS_DAYS} días.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {signupIpGroups.map(g => {
                const key = `ip-${g.ip}`
                const expanded = expandedKey === key
                return (
                  <div key={key} className="border border-white/5 rounded-[6px]">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(key)}
                      className="w-full flex justify-between items-center px-4 py-3 bg-transparent border-none cursor-pointer text-left hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="font-['Montserrat',sans-serif] text-xs font-medium px-2 py-1 rounded-[4px]"
                          style={{ color: severityColor(g.count, 5), background: severityColor(g.count, 5) + '15', minWidth: '40px', textAlign: 'center' }}
                        >
                          ×{g.count}
                        </span>
                        <span className="font-mono text-sm text-white/85 truncate">{g.ip}</span>
                      </div>
                      <span className="font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/40">
                        {expanded ? '▼ ocultar' : '▶ ver cuentas'}
                      </span>
                    </button>
                    {expanded && (
                      <div className="border-t border-white/5 p-4 bg-[var(--v-bg-base)]">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-white/40 font-['Montserrat',sans-serif] uppercase text-[9px] tracking-[.16em]">
                              <th className="pb-2">Email</th>
                              <th className="pb-2">Name</th>
                              <th className="pb-2">KYC</th>
                              <th className="pb-2">Signed up</th>
                              <th className="pb-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.users.map(u => (
                              <tr key={u.id} className="border-t border-white/5">
                                <td className="py-2 pr-2 text-white/80 text-[11px]">{u.email}</td>
                                <td className="py-2 pr-2 text-white/65 text-[11px]">{u.full_name || '—'}</td>
                                <td className="py-2 pr-2 text-[10px]" style={{ color: u.verification_status === 'approved' ? 'var(--v-success)' : u.verification_status === 'pending' ? 'var(--v-accent)' : 'var(--v-text-tertiary)' }}>
                                  {u.verification_status || 'unverified'}
                                </td>
                                <td className="py-2 pr-2 text-white/50">{formatDate(u.signup_at)}</td>
                                <td className="py-2">
                                  <Link
                                    href={`/admin/audit-log?actorId=${u.id}`}
                                    className="font-['Montserrat',sans-serif] text-[9px] tracking-[.16em] uppercase text-[var(--v-accent)] no-underline"
                                  >
                                    Audit log
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="bg-[var(--v-bg-card)] border border-white/5 rounded-[6px] p-5 mb-6">
          <header className="flex flex-wrap justify-between items-baseline gap-2 mb-4">
            <div>
              <h2 className="font-['Switzer',sans-serif] text-xl font-normal text-[var(--v-accent)]">
                Spam reporters (últimas {RECENT_REPORTS_HOURS}h)
              </h2>
              <p className="font-['Montserrat',sans-serif] text-[10px] text-white/40 mt-1">
                Threshold: ≥{REPORT_IP_THRESHOLD} reports desde la misma IP. Indica adversario tratando de banear competencia / sabotaje. El rate-limit del endpoint /api/report ya capa 10/h por IP, pero esto captura el patrón sostenido en 24h.
              </p>
            </div>
            <span className="font-['Montserrat',sans-serif] text-[10px] text-white/50">
              {loadingReports ? 'cargando…' : `${reportIpGroups.length} grupos`}
            </span>
          </header>
          {reportIpGroups.length === 0 && !loadingReports ? (
            <p className="text-[10px] text-white/40 font-['Montserrat',sans-serif]">Sin spam reporters en las últimas {RECENT_REPORTS_HOURS} horas.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {reportIpGroups.map(g => {
                const key = `report-ip-${g.ip}`
                const expanded = expandedKey === key
                return (
                  <div key={key} className="border border-white/5 rounded-[6px]">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(key)}
                      className="w-full flex justify-between items-center px-4 py-3 bg-transparent border-none cursor-pointer text-left hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="font-['Montserrat',sans-serif] text-xs font-medium px-2 py-1 rounded-[4px]"
                          style={{ color: severityColor(g.count, 10), background: severityColor(g.count, 10) + '15', minWidth: '40px', textAlign: 'center' }}
                        >
                          ×{g.count}
                        </span>
                        <span className="font-mono text-sm text-white/85 truncate">{g.ip}</span>
                      </div>
                      <span className="font-['Montserrat',sans-serif] text-[9px] tracking-[.18em] uppercase text-white/40">
                        {expanded ? '▼ ocultar' : '▶ ver reports'}
                      </span>
                    </button>
                    {expanded && (
                      <div className="border-t border-white/5 p-4 bg-[var(--v-bg-base)]">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-white/40 font-['Montserrat',sans-serif] uppercase text-[9px] tracking-[.16em]">
                              <th className="pb-2">Post ID</th>
                              <th className="pb-2">Category</th>
                              <th className="pb-2">Status</th>
                              <th className="pb-2">Created</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.reports.map(r => (
                              <tr key={r.id} className="border-t border-white/5">
                                <td className="py-2 pr-2 font-mono text-white/55 text-[10px]">{r.post_id.slice(0, 8)}…</td>
                                <td className="py-2 pr-2 text-white/80 text-[11px]">{r.category}</td>
                                <td className="py-2 pr-2 text-white/60 text-[11px]">{r.status || 'pending'}</td>
                                <td className="py-2 pr-2 text-white/50">{formatDate(r.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
