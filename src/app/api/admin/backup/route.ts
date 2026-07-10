import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'

export const runtime = 'nodejs'

/**
 * Manual admin backup endpoint.
 *
 * Previously gated on a single shared header (`x-admin-secret` vs
 * `ADMIN_SECRET`). If that secret leaked — logs, repo history, a
 * compromised dev env — anyone could pull a full posts + profiles dump
 * over HTTP. Auth now flows through `requireAdmin()`, so the caller needs
 * a live admin session (cookie or Bearer). The shared-secret header is
 * kept as an emergency CLI path (you still need the real secret AND an
 * IP that isn't rate-limited) but is now a second lane rather than the
 * only lock on the door.
 *
 * Scheduled backups live in `/api/cron/backup` and use `CRON_SECRET` —
 * unchanged.
 */
export async function GET(req: NextRequest) {
  const hdrSecret = req.headers.get('x-admin-secret')
  const cliLane = !!process.env.ADMIN_SECRET && hdrSecret === process.env.ADMIN_SECRET

  if (!cliLane) {
    const gate = await requireAdmin(req)
    if (!gate.ok) return gate.response
  }

  const supabase = getSupabaseAdmin()

  const [{ data: posts }, { data: profiles }] = await Promise.all([
    supabase.from('posts').select('*').order('created_at', { ascending: false }),
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
  ])

  const date     = new Date().toISOString().slice(0, 10)
  const filename = `marketplace-backup-${date}.json`
  const body     = JSON.stringify({ exported_at: new Date().toISOString(), posts, profiles }, null, 2)

  return new Response(body, {
    headers: {
      'Content-Type':        'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
