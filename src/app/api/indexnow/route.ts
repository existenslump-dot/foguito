import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/clients/require-admin'
import { submitIndexNow } from '@/lib/indexnow'
import { BASE_URL } from '@/lib/seo'

export const runtime = 'nodejs'

const IndexNowSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(10_000),
})

/**
 * POST /api/indexnow
 * Body: { urls: string[] }
 *
 * Manual submission endpoint for admin — useful for re-pinging a batch
 * of URLs after a copy/metadata change or after restoring archived
 * content. Post-approval pings are wired directly into
 * /api/admin/approve-post and don't go through this route.
 *
 * All URLs must belong to example.com (IndexNow rejects cross-host
 * submissions under a single key, and so do we).
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireAdmin(req)
    if (!gate.ok) return gate.response

    const parsed = IndexNowSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid body' },
        { status: 400 },
      )
    }

    const urls = parsed.data.urls.filter(u => u.startsWith(BASE_URL))
    if (urls.length === 0) {
      return NextResponse.json(
        { error: `All urls must start with ${BASE_URL}` },
        { status: 400 },
      )
    }

    const result = await submitIndexNow(urls)
    return NextResponse.json({ ...result, submitted: urls.length })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Error desconocido',
    }, { status: 500 })
  }
}
