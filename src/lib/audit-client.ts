/**
 * Client-side helper to record events in audit_log via the `/api/audit/log`
 * endpoint, for admin panel or any client-side flow that needs to log without
 * its own dedicated server endpoint:
 *
 *   await recordAuditClient({
 *     eventType: 'post_rejected',
 *     subjectType: 'post',
 *     subjectId: postId,
 *     metadata: { reason },
 *   })
 *
 * Fire-and-forget — always returns void; errors are logged with console.error
 * but never propagated (audit must never block business logic). The actor
 * user id is resolved server-side from the session, never trusted from the
 * client payload. Server-side counterpart: recordAudit() in src/lib/audit.ts.
 */

export type RecordAuditClientOpts = {
  /** Event kind: kyc_approved, kyc_rejected, post_rejected, post_deleted, etc. */
  eventType: string
  /** Subject type: 'profile', 'post', 'report', 'verification'. */
  subjectType?: string
  /** UUID of the affected subject. */
  subjectId?: string
  /** Arbitrary contextual payload (rejection_reason, status_before, etc). */
  metadata?: Record<string, unknown>
}

export async function recordAuditClient(opts: RecordAuditClientOpts): Promise<void> {
  try {
    const res = await fetch('/api/audit/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    })
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: 'unknown' }))
      console.error('[audit-client] endpoint rejected', {
        eventType: opts.eventType,
        status: res.status,
        error: errBody,
      })
    }
  } catch (err) {
    console.error('[audit-client] network error (non-fatal)', {
      eventType: opts.eventType,
      error: err,
    })
  }
}
