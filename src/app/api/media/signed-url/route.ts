import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { getSignedUrl, getWatermarkedUrl } from '@/lib/cloudinary.server'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/ip'
import { requireVerifiedUser } from '@/lib/authCheck'
import { logAudit } from '@/lib/auditLog'
import { isSameOrigin } from '@/lib/clients/same-origin'

export const runtime = 'nodejs'

const TIER_RANK: Record<string, number> = {
  basic: 1,
  bronze: 2,
  silver: 3,
  gold: 4,
}

export async function POST(req: NextRequest) {
  try {
    // Same-origin guard — `requireVerifiedUser` is custom (doesn't share
    // the requireUser wrapper) and lacks an origin check. Add it here so
    // a cross-origin call can't extract signed Cloudinary URLs.
    if (!isSameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    }

    const response = NextResponse.next()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return req.cookies.get(name)?.value },
          set(name: string, value: string, options: CookieOptions) { response.cookies.set({ name, value, ...options }) },
          remove(name: string, options: CookieOptions) { response.cookies.set({ name, value: '', ...options }) },
        },
      },
    )

    const { user, error: authError } = await requireVerifiedUser(supabase)
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: authError.status })
    }

    const { success, retryAfter } = await rateLimit(`signed-url:${user.id}`, 100, 60 * 60 * 1000)
    if (!success) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      )
    }

    const { publicId, requiredTier } = await req.json()
    if (!publicId || typeof publicId !== 'string') {
      return NextResponse.json({ error: 'Missing publicId' }, { status: 400 })
    }

    if (requiredTier && TIER_RANK[requiredTier]) {
      const { data: post } = await supabase
        .from('posts')
        .select('tier, user_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()

      const userTierRank = TIER_RANK[post?.tier ?? 'basic'] ?? 1
      const requiredRank = TIER_RANK[requiredTier] ?? 1

      if (userTierRank < requiredRank) {
        return NextResponse.json({ error: 'Insufficient tier' }, { status: 403 })
      }
    }

    const tierRank = TIER_RANK[requiredTier] ?? 0
    let url: string
    if (tierRank >= TIER_RANK.bronze) {
      const username = user.email?.split('@')[0] ?? 'user'
      url = getWatermarkedUrl(publicId, username, 3600)

      const ip = getClientIp(req)
      await logAudit({
        userId: user.id,
        action: tierRank >= TIER_RANK.gold ? 'content_access_premium' : 'content_access_standard',
        resource: publicId,
        ipAddress: ip !== 'unknown' ? ip : undefined,
      })
    } else {
      url = getSignedUrl(publicId, 3600)
    }
    return NextResponse.json({ url })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
