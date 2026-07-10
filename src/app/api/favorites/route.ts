import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireUser, getOptionalUser } from '@/lib/clients/require-user'

// Favorites are bound to the authenticated user — never accept `user_id`
// from the request body (used to let any client impersonate others).

export async function POST(request: NextRequest) {
  try {
    const gate = await requireUser(request)
    if (!gate.ok) return gate.response
    const userId = gate.userId

    const supabase = getSupabaseAdmin()
    const { post_id } = await request.json()
    if (!post_id) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('favorites')
      .select('id')
      .eq('post_id', post_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (existing) {
      await supabase.from('favorites').delete().eq('id', existing.id)
    } else {
      await supabase.from('favorites').insert({ post_id, user_id: userId })
      await supabase.from('analytics_events').insert({
        post_id,
        event_type: 'favorite',
        user_id: userId,
      })
    }

    const { count } = await supabase
      .from('favorites')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', post_id)

    // Sync favorites_count on post
    await supabase.from('posts').update({ favorites_count: count ?? 0 }).eq('id', post_id)

    return NextResponse.json({ favorited: !existing, count: count ?? 0 })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const post_id = request.nextUrl.searchParams.get('post_id')
    if (!post_id) {
      return NextResponse.json({ error: 'Missing post_id' }, { status: 400 })
    }

    const { count } = await supabase
      .from('favorites')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', post_id)

    // `favorited` flag is per-user — derive from the session, not a query
    // param. Anonymous callers just get `false`.
    const userId = await getOptionalUser(request)
    let favorited = false
    if (userId) {
      const { data } = await supabase
        .from('favorites')
        .select('id')
        .eq('post_id', post_id)
        .eq('user_id', userId)
        .maybeSingle()
      favorited = !!data
    }

    return NextResponse.json({ count: count ?? 0, favorited })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
