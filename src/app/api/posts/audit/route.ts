import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/clients/require-user'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { validationError } from '@/lib/validation/schemas'
import { getClientIp } from '@/lib/ip'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * Capture audit trail metadata (IP + timestamp) for post create/edit events.
 *
 * Called fire-and-forget by /dashboard/edit/[id] and /admin/create AFTER the
 * client-side supabase mutation succeeds. This endpoint only writes the audit
 * columns server-side with the IP captured from the request headers.
 *
 * If the user closes the tab between the supabase mutation and this call, the
 * audit is lost; the next edit on the same post backfills last_edited_ip + at.
 */

const AuditSchema = z.object({
  postId: z.string().uuid(),
  event:  z.enum(['create', 'edit']),
})

export async function POST(req: Request) {
  const gate = await requireUser(req)
  if (!gate.ok) return gate.response
  const { userId } = gate

  const parsed = AuditSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(validationError(parsed.error), { status: 400 })
  }
  const { postId, event } = parsed.data

  const ip = getClientIp(req)
  const now = new Date().toISOString()
  const admin = getSupabaseAdmin()

  // Verify ownership or admin role. Service-role bypasses RLS, so we have to
  // gate access manually — without this any logged-in user could write audit
  // entries on arbitrary posts.
  const [{ data: post, error: postErr }, { data: profile, error: profileErr }] = await Promise.all([
    admin.from('posts').select('id, user_id, created_ip').eq('id', postId).maybeSingle(),
    admin.from('profiles').select('is_admin').eq('id', userId).maybeSingle(),
  ])

  if (postErr) {
    console.error('[posts/audit] post fetch failed', { postId, error: postErr })
    return NextResponse.json({ error: 'Could not load post' }, { status: 500 })
  }
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }
  if (profileErr) {
    console.error('[posts/audit] profile fetch failed', { userId, error: profileErr })
  }
  const isAdmin = profile?.is_admin === true
  if (post.user_id !== userId && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 'create' is idempotent — if created_ip already has a value, leave it as
  // the historical first capture.
  // 'edit' always overwrites — last edit wins.
  const update: Record<string, string> = {}
  if (event === 'create') {
    if (!post.created_ip) update.created_ip = ip
  } else {
    update.last_edited_ip = ip
    update.last_edited_at = now
  }

  if (Object.keys(update).length === 0) {
    // 'create' on a post that already has created_ip — no-op, but still 200
    // so the client doesn't treat it as an error.
    return NextResponse.json({ ok: true, skipped: 'already_recorded' })
  }

  const { error: updErr } = await admin
    .from('posts')
    .update(update)
    .eq('id', postId)

  if (updErr) {
    console.error('[posts/audit] update failed', { postId, event, error: updErr })
    return NextResponse.json({ error: 'Could not write audit entry' }, { status: 500 })
  }

  void recordAudit({
    eventType: event === 'create' ? 'post_created' : 'post_edited',
    actorRole: isAdmin ? 'admin' : 'user',
    actorUserId: userId,
    subjectType: 'post',
    subjectId: postId,
    req,
    ip,
    metadata: {
      post_owner_user_id: post.user_id,
      ...(post.user_id !== userId ? { admin_acted_on_other_user: true } : {}),
    },
  })

  return NextResponse.json({ ok: true, event, fields_written: Object.keys(update), timestamp: now })
}
