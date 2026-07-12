import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * `moderation_events` helpers — la cola de QUEJAS sobre contenido de creadora
 * (PR-9). La tabla es deny-all (RLS forzada, cero políticas): TODO lo de acá
 * corre con el service-role `admin` que bypassa RLS. Nunca se expone al fan ni a
 * la creadora — sin oráculo (una queja no confirma existencia de contenido).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ El takedown NO vive en una tabla aparte: se propaga con                     │
 * │ `content.status='removed'` (la RLS `content_select` + los guards de PR-5    │
 * │ cortan la entrega en toda superficie ANTES del check de entitlement). Acá   │
 * │ sólo se lista/triage la cola y se computa el SLA/overdue. El export a        │
 * │ autoridad (referencias, nunca bytes/PII) vive en su propia ruta.            │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export type ComplaintCategory =
  | 'illegal'
  | 'dmca'
  | 'nonconsensual'
  | 'csam_suspected'
  | 'spam'
  | 'other'

export type ComplaintStatus = 'open' | 'triaging' | 'actioned' | 'dismissed'
export type ComplaintResolution = 'takedown' | 'dismissed' | 'escalated_csam'

// ── SLA por categoría ───────────────────────────────────────────────────────
// Escalonado por severidad: lo ilegal / no-consentido / CSAM-sospechado se
// triagea en 24h, DMCA en 72h, el resto (spam/otro) en 168h (7 días). El intake
// clava `sla_due_at = now() + intervalo`; el cron marca la brecha al vencer.
const HOUR_MS = 60 * 60 * 1000

export const SLA_HOURS_BY_CATEGORY: Record<ComplaintCategory, number> = {
  illegal:        24,
  nonconsensual:  24,
  csam_suspected: 24,
  dmca:           72,
  spam:           168,
  other:          168,
}

/** Intervalo de SLA (ms) para una categoría. Fallback conservador a 168h. */
export function slaIntervalMs(category: ComplaintCategory): number {
  return (SLA_HOURS_BY_CATEGORY[category] ?? 168) * HOUR_MS
}

/** `sla_due_at` (ISO) escalonado por categoría — lo usa el intake al insertar. */
export function slaDueAtForCategory(
  category: ComplaintCategory,
  nowMs: number = Date.now(),
): string {
  return new Date(nowMs + slaIntervalMs(category)).toISOString()
}

// ── Fila de queja ───────────────────────────────────────────────────────────

export type ModerationEvent = {
  id: string
  content_id: string | null
  creator_id: string | null
  reporter_user_id: string | null
  reporter_ip: string | null
  category: ComplaintCategory
  description: string | null
  status: ComplaintStatus
  sla_due_at: string | null
  resolution: ComplaintResolution | null
  resolved_by: string | null
  resolved_at: string | null
  authority_export_status: 'none' | 'generated'
  created_at: string
}

const EVENT_COLS =
  'id, content_id, creator_id, reporter_user_id, reporter_ip, category, description, status, sla_due_at, resolution, resolved_by, resolved_at, authority_export_status, created_at'

/**
 * ¿La queja está vencida? SOLO cuenta como overdue si sigue `status='open'` y su
 * `sla_due_at` ya pasó. Una queja en triage/resuelta NUNCA es overdue (mirror de
 * la definición del cron y del índice parcial de la DB).
 */
export function isOverdue(
  ev: Pick<ModerationEvent, 'status' | 'sla_due_at'>,
  nowMs: number = Date.now(),
): boolean {
  return ev.status === 'open' && !!ev.sla_due_at && new Date(ev.sla_due_at).getTime() < nowMs
}

/** Resumen SEGURO del contenido para la cola — NUNCA `media_ref` (ni bytes). */
export type ContentBrief = {
  id: string
  title: string | null
  creator_id: string
  status: string
}

export type OpenComplaint = ModerationEvent & {
  overdue: boolean
  content: ContentBrief | null
}

/**
 * Lista las quejas ABIERTAS de la cola de moderación (`status IN open|triaging`),
 * con el resumen SEGURO del contenido adjunto (segunda consulta, joineada en
 * memoria — NUNCA se selecciona `media_ref`) y el flag `overdue` computado.
 *
 * Orden: primero las vencidas, y dentro de cada grupo por deadline de SLA más
 * cercano (más urgente arriba) y, a empate, la más nueva primero.
 *
 * MUST correr con el service-role `admin` (la tabla es deny-all).
 */
export async function listOpenComplaints(
  admin: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<{ ok: true; complaints: OpenComplaint[] } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('moderation_events')
    .select(EVENT_COLS)
    .in('status', ['open', 'triaging'])
    // Deadline más cercano primero (más urgente); a empate, más nueva primero.
    .order('sla_due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) return { ok: false, error: error.message }

  const events = (data ?? []) as ModerationEvent[]

  // Resumen SEGURO del contenido — segunda consulta acotada a los ids presentes.
  // NUNCA `media_ref`: la cola no entrega media, sólo metadata de contexto.
  const contentIds = [
    ...new Set(events.map((e) => e.content_id).filter((x): x is string => Boolean(x))),
  ]
  const contentMap = new Map<string, ContentBrief>()
  if (contentIds.length > 0) {
    const { data: rows } = await admin
      .from('content')
      .select('id, title, creator_id, status')
      .in('id', contentIds)
    for (const r of (rows ?? []) as ContentBrief[]) contentMap.set(r.id, r)
  }

  const complaints: OpenComplaint[] = events.map((e) => ({
    ...e,
    overdue: isOverdue(e, nowMs),
    content: e.content_id ? contentMap.get(e.content_id) ?? null : null,
  }))

  // Sort estable (Node/V8): flota las vencidas arriba conservando el orden de la
  // query (SLA más cercano → más nueva) dentro de cada grupo.
  complaints.sort((a, b) => Number(b.overdue) - Number(a.overdue))

  return { ok: true, complaints }
}
