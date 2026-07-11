import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { listIncompletePerformers } from '@/lib/performers'

export const runtime = 'nodejs'

/**
 * GET /api/admin/performers?complete=false
 *
 * Admin-only: the 2257 review queue — records not yet certified complete.
 * Returns ONLY safe fields (id, added_by, custodian, is_self, flags, created_at).
 * The legal name stays ENCRYPTED here; it is decrypted only in the per-id review
 * route (/api/admin/performers/[id]), never in the list.
 *
 * `performers_2257` is RLS-scoped to the owner/admin; this goes through the
 * service role, same pattern as /api/admin/verification-session.
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.response

  // `?complete=false` is the review queue (the default + only mode today).
  const admin = getSupabaseAdmin()
  const res = await listIncompletePerformers(admin)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })
  return NextResponse.json({ performers: res.performers })
}
