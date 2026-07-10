import 'server-only'
import { createClient } from '@supabase/supabase-js'

type AuditAction =
  | 'plan_change'
  | 'content_access_standard'
  | 'content_access_premium'
  | 'login_failed'
  | 'signout_all'
  | 'admin_action'
  | 'account_delete'
  | 'totp_disabled'
  | 'totp_recovery_used'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function logAudit(params: {
  userId?: string
  action: AuditAction
  resource?: string
  metadata?: Record<string, unknown>
  ipAddress?: string
}) {
  try {
    const supabase = getServiceClient()
    const { error } = await supabase.from('audit_log').insert({
      user_id: params.userId,
      action: params.action,
      resource: params.resource,
      metadata: params.metadata,
      ip_address: params.ipAddress,
    })
    // Security events should never silently disappear. If the INSERT
    // fails (policy, column drift, connection) surface it loudly — we
    // still don't throw, the caller's main flow (account_delete, admin
    // action, login_failed) must complete, but Sentry + logs MUST see it
    // so stale audit gaps don't go unnoticed.
    if (error) {
      console.error('[audit] insert rejected — event not persisted', {
        action: params.action,
        userId: params.userId,
        code: error.code,
        message: error.message,
        details: error.details,
      })
    }
  } catch (err) {
    // Never let audit logging break the main flow — but make the failure
    // obvious in the logs so a silent outage doesn't swallow every event.
    console.error('[audit] logger threw — event not persisted', {
      action: params.action,
      userId: params.userId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
