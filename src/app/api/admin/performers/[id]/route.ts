import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { getPerformerForReview } from '@/lib/performers'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/admin/performers/[id]
 *
 * Admin-only: full 2257 record for review — the legal name DECRYPTED server-side
 * + a short-lived signed URL to the ID document. NEVER exposed to a non-admin:
 * the decrypted PII + signed doc URL leave the building only through this
 * admin-gated route (mirrors /api/admin/identity-doc + verification-session).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.response

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'id inválido (UUID esperado)' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const performer = await getPerformerForReview(admin, id)
  if (!performer) {
    return NextResponse.json({ performer: null }, { status: 404 })
  }
  return NextResponse.json({ performer })
}
