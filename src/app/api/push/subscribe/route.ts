import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireUser } from '@/lib/clients/require-user'

export async function POST(req: Request) {
  const gate = await requireUser(req)
  if (!gate.ok) return gate.response
  const userId = gate.userId

  const { subscription } = await req.json()
  if (!subscription) {
    return Response.json({ error: 'Missing subscription' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: userId, subscription },
    { onConflict: 'user_id' }
  )

  if (error) {
    console.error('Push subscribe error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true }, { status: 200 })
}
