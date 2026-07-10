import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireUser } from '@/lib/clients/require-user'
import { BoostPurchaseSchema, validationError } from '@/lib/validation/schemas'
import { MARKETPLACE, PAYMENTS_ENABLED } from '@/config/marketplace.config'

export const runtime = 'nodejs'

/**
 * Buy a feed boost for one of the caller's published posts, paid in credits.
 *
 * Server-authoritative end to end: the buyer comes from the session
 * (requireUser — never the body), price + duration come from
 * MARKETPLACE.billing.boost (never the body), and the whole
 * check-owner → claim-idempotency-key → deduct-credits → stamp-boost
 * sequence runs inside the atomic `purchase_post_boost` RPC. The
 * `posts_guard_paid_flags` trigger keeps clients from setting the boost
 * columns directly, so this route is the only way to boost.
 *
 * Replay-safe: the client sends a per-attempt `idempotency_key` (UUID); a
 * double-click or network retry maps to 'already-applied' and charges once.
 */
export async function POST(req: NextRequest) {
  // Credits/boost belong to the payments add-on: inert when it's off.
  if (!PAYMENTS_ENABLED) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  try {
    const gate = await requireUser(req)
    if (!gate.ok) return gate.response

    const parsed = BoostPurchaseSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 })
    }
    const { post_id, idempotency_key } = parsed.data
    const { credits: cost, durationDays } = MARKETPLACE.billing.boost

    const admin = getSupabaseAdmin()
    const { data, error } = await admin.rpc('purchase_post_boost', {
      p_post_id: post_id,
      p_user_id: gate.userId,
      p_cost: cost,
      p_duration_days: durationDays,
      p_idempotency_key: idempotency_key,
    })

    if (error) {
      console.error('[posts/boost] rpc failed:', { post_id, error })
      return NextResponse.json({ error: 'No se pudo activar el boost' }, { status: 500 })
    }

    const result = String(data)
    switch (result) {
      case 'applied':
      case 'already-applied': {
        // Return the post's current boost end so the dashboard can patch
        // its local state without refetching the whole grid.
        const { data: post } = await admin
          .from('posts').select('boost_ends_at').eq('id', post_id).maybeSingle()
        return NextResponse.json({
          success: true,
          already: result === 'already-applied',
          boost_ends_at: post?.boost_ends_at ?? null,
        })
      }
      case 'insufficient-credits':
        return NextResponse.json(
          { error: 'insufficient_credits', message: 'No te alcanzan los créditos para este boost.' },
          { status: 402 },
        )
      case 'not-owner':
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      case 'not-found':
        return NextResponse.json({ error: 'not_found' }, { status: 404 })
      case 'not-published':
        return NextResponse.json(
          { error: 'not_published', message: 'Solo una publicación activa puede recibir boost.' },
          { status: 409 },
        )
      default:
        console.error('[posts/boost] unexpected rpc result:', result)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
  } catch (err) {
    console.error('[posts/boost] unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
