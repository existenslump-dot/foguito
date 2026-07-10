import { NextResponse } from 'next/server'
import { getSupabaseAnon } from '@/lib/clients/supabase-admin'

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAnon()
    const { post_id, event_type, photo_index, user_id } = await request.json()

    if (!post_id || !event_type) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Record the post's country slug on the event so dashboards can segment
    // by market without joining posts (analytics_events has its own `city`
    // column; we store the country slug there for backward compat with
    // existing reports).
    const { data: post } = await supabase
      .from('posts')
      .select('countries(slug)')
      .eq('id', post_id)
      .single<{ countries: { slug: string } | null }>()

    await supabase.from('analytics_events').insert({
      post_id,
      event_type,
      photo_index: photo_index ?? null,
      city: post?.countries?.slug ?? null,
      user_id: user_id ?? null,
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
