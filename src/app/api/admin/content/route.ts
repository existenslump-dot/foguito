import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { listContentForModeration } from '@/lib/content'

export const runtime = 'nodejs'

/**
 * GET /api/admin/content
 *
 * Admin-only: the content moderation queue — rows still awaiting a decision
 * (status in 'uploaded' | 'in_review'). SAFE summaries only; the private
 * media path is NOT returned here — the signed URL is minted per-id in
 * /api/admin/content/[id]. Goes through the service role (content is RLS-scoped),
 * same pattern as /api/admin/performers.
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.response

  const admin = getSupabaseAdmin()
  const res = await listContentForModeration(admin, ['uploaded', 'in_review'])
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })
  return NextResponse.json({ content: res.content })
}
