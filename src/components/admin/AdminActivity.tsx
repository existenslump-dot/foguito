'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { COUNTRY_LABEL } from '@/config/marketplace.config'

type Buckets = {
  total:      number
  prevTotal:  number
  postsAppr:  number
  kycProc:    number
  reportsRes: number
  perDay:     number[]
}

const MONO = { fontFamily: "'Montserrat',sans-serif" } as const
const ADMIN_EVENT_TYPES = [
  'post_approved',
  'kyc_approved',
  'kyc_rejected',
  'report_actioned',
  'report_dismissed',
] as const

const DAY_MS = 24 * 60 * 60 * 1000

export default function AdminActivity() {
  const [data, setData] = useState<Buckets | null>(null)
  const [err,  setErr]  = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const now    = Date.now()
      const start  = new Date(now - 14 * DAY_MS).toISOString()
      const { data: rows, error } = await supabase
        .from('audit_log')
        .select('event_type, created_at')
        .in('event_type', ADMIN_EVENT_TYPES as unknown as string[])
        .gte('created_at', start)
        .order('created_at', { ascending: true })

      if (cancelled) return
      if (error) { setErr(error.message); return }

      const perDay = new Array(7).fill(0)
      let total = 0, prevTotal = 0
      let postsAppr = 0, kycProc = 0, reportsRes = 0

      for (const row of rows || []) {
        const ts = new Date(row.created_at).getTime()
        if (Number.isNaN(ts)) continue
        const ageMs = now - ts
        if (ageMs < 7 * DAY_MS) {
          total++
          const dayIndex = 6 - Math.floor(ageMs / DAY_MS)
          if (dayIndex >= 0 && dayIndex < 7) perDay[dayIndex]++
          if (row.event_type === 'post_approved') postsAppr++
          else if (row.event_type === 'kyc_approved' || row.event_type === 'kyc_rejected') kycProc++
          else if (row.event_type === 'report_actioned' || row.event_type === 'report_dismissed') reportsRes++
        } else if (ageMs < 14 * DAY_MS) {
          prevTotal++
        }
      }

      setData({ total, prevTotal, postsAppr, kycProc, reportsRes, perDay })
    })()
    return () => { cancelled = true }
  }, [])

  const deltaLabel = (() => {
    if (!data) return ''
    if (data.prevTotal === 0 && data.total === 0) return '— sin actividad'
    if (data.prevTotal === 0) return '↑ nuevo'
    const pct = Math.round(((data.total - data.prevTotal) / data.prevTotal) * 100)
    if (pct === 0) return '— estable vs sem. anterior'
    return `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs sem. anterior`
  })()
  const deltaClass = (() => {
    if (!data) return 'mute'
    if (data.total > data.prevTotal) return ''
    if (data.total < data.prevTotal) return 'neg'
    return 'mute'
  })()

  const spark = (() => {
    if (!data) return { line: '', area: '' }
    const max = Math.max(1, ...data.perDay)
    const points = data.perDay.map((v, i) => {
      const x = (i / 6) * 100
      const y = 28 - (v / max) * 22
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    const line = `M${points.join(' L')}`
    const area = `${line} L100,30 L0,30 Z`
    return { line, area }
  })()

  return (
    <div className="adm-card adm-activity-card">
      <div className="adm-card-head">
        <h3>Actividad · 7 días</h3>
        <span className="adm-card-ct">{COUNTRY_LABEL}</span>
      </div>
      <div className="adm-activity-body">
        {err && (
          <p className="adm-activity-err" style={MONO}>
            No se pudo cargar la actividad: {err}
          </p>
        )}
        {!err && !data && (
          <p className="adm-activity-loading" style={MONO}>Cargando…</p>
        )}
        {data && (
          <>
            <div className="adm-activity-total">
              <span className="adm-activity-v">{data.total}</span>
              <span className={`adm-activity-delta ${deltaClass}`} style={MONO}>{deltaLabel}</span>
            </div>
            <svg
              className="adm-activity-spark"
              viewBox="0 0 100 30"
              preserveAspectRatio="none"
              aria-hidden
            >
              <path d={spark.area} fill="rgba(37, 99, 235,0.12)" />
              <path d={spark.line} fill="none" stroke="var(--v-accent)" strokeWidth="1.5" />
            </svg>
            <div className="adm-activity-rows">
              <div className="adm-activity-r">
                <span className="adm-activity-r-l" style={MONO}>Publicaciones aprobadas</span>
                <span className="adm-activity-r-v">{data.postsAppr}</span>
              </div>
              <div className="adm-activity-r">
                <span className="adm-activity-r-l" style={MONO}>Verificaciones procesadas</span>
                <span className="adm-activity-r-v">{data.kycProc}</span>
              </div>
              <div className="adm-activity-r">
                <span className="adm-activity-r-l" style={MONO}>Reportes resueltos</span>
                <span className="adm-activity-r-v">{data.reportsRes}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
