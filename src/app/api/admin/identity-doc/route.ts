import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'

export const runtime = 'nodejs'

/**
 * GET /api/admin/identity-doc?path=<storage path>
 *
 * Admin-only: returns a signed URL to view an identity-verification document
 * (document / selfie / video).
 *
 * The `identity-documents` bucket has per-user RLS — each account only
 * accesses `{auth.uid()}/*`. An admin CANNOT generate the signed URL from the
 * client: their uid doesn't match another user's document path, so
 * `createSignedUrl` fails. The service-role client bypasses RLS, just as
 * /api/admin/identity-upload does for the upload.
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.response

  const path = (req.nextUrl.searchParams.get('path') ?? '').trim()
  if (!path || path.includes('..')) {
    return NextResponse.json({ error: 'path inválido' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin.storage
    .from('identity-documents')
    .createSignedUrl(path, 3600)

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: error?.message ?? 'No se pudo generar la URL' },
      { status: 500 },
    )
  }
  return NextResponse.json({ url: data.signedUrl })
}
