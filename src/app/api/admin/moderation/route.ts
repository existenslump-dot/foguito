import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { listOpenComplaints } from '@/lib/moderation'

export const runtime = 'nodejs'

/**
 * GET /api/admin/moderation
 *
 * Admin-only: la cola de QUEJAS abiertas (status in 'open' | 'triaging'), con el
 * resumen SEGURO del contenido (título/creadora/estado — NUNCA `media_ref`) y el
 * flag `overdue` computado. `moderation_events` es deny-all, así que va por el
 * service-role (mismo patrón que /api/admin/content).
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.response

  const admin = getSupabaseAdmin()
  const res = await listOpenComplaints(admin)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })
  return NextResponse.json({ complaints: res.complaints })
}
