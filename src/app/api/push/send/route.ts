import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import webPush from 'web-push'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const { userId, title, body, url } = await req.json()

  // Admin-only check via secret
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.NEXT_PUBLIC_VAPID_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return Response.json({ error: 'VAPID keys not configured' }, { status: 500 })
  }

  webPush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@example.com',
    process.env.NEXT_PUBLIC_VAPID_KEY,
    process.env.VAPID_PRIVATE_KEY
  )

  const supabase = getSupabaseAdmin()

  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId)
    .single()

  if (!sub) {
    return Response.json({ error: 'No subscription found' }, { status: 404 })
  }

  try {
    await webPush.sendNotification(
      sub.subscription,
      JSON.stringify({ title, body, url })
    )
    return Response.json({ success: true }, { status: 200 })
  } catch (err) {
    console.error('Push send error:', err)
    return Response.json({ error: 'Failed to send push' }, { status: 500 })
  }
}
