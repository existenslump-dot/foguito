import { NextRequest, NextResponse } from 'next/server'
import 'server-only'
import { requireUser } from '@/lib/clients/require-user'
import { destroyCloudinaryAssets } from '@/lib/cloudinary.server'

/**
 * Delete one-or-more Cloudinary assets by secure URL.
 *
 * Used as the rollback arm for the create-post flow: if the Supabase INSERT
 * fails AFTER uploads finished, the client fires this route with every URL
 * it uploaded so we don't leave orphan files racking up Cloudinary quota.
 *
 * Security: callable only with a valid Supabase session — previously the
 * JSDoc claimed this but the code never actually enforced it, so an
 * unauthenticated attacker could destroy any of our Cloudinary assets by
 * URL. Now guarded by `requireUser`. Each URL must also belong to our
 * Cloudinary cloud or the call rejects it, preventing the
 * endpoint from being weaponised against arbitrary tenants.
 *
 * Input:  { urls: string[] } — full secure URLs from uploads
 * Output: { deleted: number, failed: string[] }
 */

export async function POST(req: NextRequest) {
  try {
    const gate = await requireUser(req)
    if (!gate.ok) return gate.response

    const body = await req.json().catch(() => ({}))
    const urls: string[] = Array.isArray(body.urls) ? body.urls.filter((u: unknown) => typeof u === 'string') : []
    if (urls.length === 0) {
      return NextResponse.json({ error: 'urls[] required' }, { status: 400 })
    }
    if (urls.length > 50) {
      // Batch cap — keeps a single cleanup from fanning out to hundreds of
      // Cloudinary calls. Anything above this is almost certainly abuse.
      return NextResponse.json({ error: 'Too many URLs (max 50)' }, { status: 400 })
    }

    const result = await destroyCloudinaryAssets(urls)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[media/cleanup] unexpected:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
