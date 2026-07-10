import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/clients/require-user'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { validationError } from '@/lib/validation/schemas'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * Generic endpoint for authenticated clients to record events in audit_log.
 *
 * Some admin actions live 100% client-side (kyc_approved, kyc_rejected,
 * post_rejected, post_deleted) — they run from the /admin panel via the
 * Supabase client directly, with no server endpoint of their own, so the
 * server-only recordAudit() can't be called from the client.
 *
 * This small endpoint can be invoked fire-and-forget after each successful
 * action. Auth is required (requireUser), actor_user_id comes from the
 * session (NEVER from the body), and actor_role is resolved server-side by
 * reading profiles.is_admin. That prevents a malicious user from forging
 * events as 'admin' or attributing actions to another user.
 *
 * Security:
 *   - eventType is free text. A malicious client could write false events
 *     attributed to itself. The audit trail is not meant to be tamper-proof
 *     against authed users — only against anons and cross-user attribution.
 *   - subject_id is free text. A user could log "post_deleted" over another
 *     user's postId, but the forensic query in /admin still shows the entry
 *     with the correct actor_user_id, so the inconsistency is detectable.
 *   - For a truly trustworthy admin-side audit, refactor to server-side
 *     endpoints.
 */

const AuditLogBodySchema = z.object({
  eventType: z.string().trim().min(1).max(100),
  subjectType: z.string().trim().min(1).max(50).optional(),
  subjectId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: Request) {
  const gate = await requireUser(req)
  if (!gate.ok) return gate.response
  const { userId } = gate

  const parsed = AuditLogBodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(validationError(parsed.error), { status: 400 })
  }
  const { eventType, subjectType, subjectId, metadata } = parsed.data

  // Resolve actor role server-side by reading profiles. If the lookup fails,
  // default to a 'user' fail-safe (never assume admin without confirming).
  let actorRole: 'user' | 'admin' = 'user'
  try {
    const admin = getSupabaseAdmin()
    const { data: profile } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle()
    if (profile?.is_admin === true) actorRole = 'admin'
  } catch (err) {
    console.error('[audit/log] profile lookup failed (defaulting to user role)', err)
  }

  void recordAudit({
    eventType,
    actorRole,
    actorUserId: userId,
    subjectType,
    subjectId,
    req,
    metadata,
  })

  return NextResponse.json({ ok: true })
}
