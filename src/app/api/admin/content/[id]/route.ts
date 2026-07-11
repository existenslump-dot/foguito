import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { getContentForReview } from '@/lib/content'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/admin/content/[id]
 *
 * Admin-only: full content record for review + a short-lived SIGNED URL to the
 * private `creator-content` media. The signed URL NEVER reaches a non-admin —
 * the paying-fan delivery channel (watermark + entitlement check) is PR-5. The
 * `creator-content` bucket is private (no RLS policies), so only the service
 * role can sign, mirroring /api/admin/identity-doc + /api/admin/performers/[id].
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.response

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id inválido (UUID esperado)' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const content = await getContentForReview(admin, id)
  if (!content) {
    return NextResponse.json({ content: null }, { status: 404 })
  }
  return NextResponse.json({ content })
}
