import 'server-only'
import { getSupabaseAdmin } from './clients/supabase-admin'
import { getClientIp } from './ip'

export type AuditActorRole = 'anonymous' | 'user' | 'admin' | 'system'

export type RecordAuditOpts = {
  eventType: string
  actorRole: AuditActorRole
  actorUserId?: string | null
  subjectType?: string
  subjectId?: string | null
  req?: Request
  ip?: string
  metadata?: Record<string, unknown>
}

export async function recordAudit(opts: RecordAuditOpts): Promise<void> {
  try {
    const admin = getSupabaseAdmin()
    const ip = opts.ip ?? (opts.req ? getClientIp(opts.req) : null)
    const userAgent = opts.req?.headers.get('user-agent') ?? null
    const { error } = await admin.from('audit_log').insert({
      actor_user_id: opts.actorUserId ?? null,
      actor_role: opts.actorRole,
      event_type: opts.eventType,
      subject_type: opts.subjectType ?? null,
      subject_id: opts.subjectId ?? null,
      ip,
      user_agent: userAgent,
      metadata: opts.metadata ?? {},
    })
    if (error) {
      console.error('[audit] insert failed (non-fatal)', {
        eventType: opts.eventType,
        actorUserId: opts.actorUserId,
        error,
      })
    }
  } catch (err) {
    console.error('[audit] unexpected error (non-fatal)', {
      eventType: opts.eventType,
      error: err,
    })
  }
}
