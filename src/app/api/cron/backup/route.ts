import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { getResend } from '@/lib/clients/resend'
import { renderEmail } from '@/lib/emails'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()

  const [{ data: posts }, { data: profiles }, { data: reports }] =
    await Promise.all([
      supabase.from('posts').select('*'),
      supabase.from('profiles').select('id,full_name,email,created_at,is_admin,is_flagged'),
      supabase.from('reports').select('*'),
    ])

  const date = new Date().toISOString().split('T')[0]
  const filename = `backup-${date}.json`
  const content = JSON.stringify({ posts, profiles, reports, date }, null, 2)

  const { error: uploadError } = await supabase.storage
    .from('backups')
    .upload(filename, new Blob([content], { type: 'application/json' }), {
      upsert: true,
    })

  if (uploadError) {
    console.error('Backup upload error:', uploadError)
    return Response.json({ error: uploadError.message }, { status: 500 })
  }

  // Keep only last 12 backups
  const { data: files } = await supabase.storage.from('backups').list()
  if (files && files.length > 12) {
    const sorted = files.sort((a, b) => a.name.localeCompare(b.name))
    const toDelete = sorted.slice(0, files.length - 12).map((f) => f.name)
    await supabase.storage.from('backups').remove(toDelete)
  }

  // Send confirmation email
  const resend = getResend()
  await resend.emails.send({
    from: 'Marketplace <noreply@example.com>',
    replyTo: 'contacto@example.com',
    to: 'admin@example.com',
    subject: `Backup semanal completado — ${date}`,
    html: renderEmail(`
      <h2 style="color:#2563EB">Backup Semanal Marketplace</h2>
      <p>Backup generado correctamente.</p>
      <p><b>Posts:</b> ${posts?.length ?? 0}</p>
      <p><b>Perfiles:</b> ${profiles?.length ?? 0}</p>
      <p><b>Reportes:</b> ${reports?.length ?? 0}</p>
      <p><b>Archivo:</b> ${filename}</p>
    `),
  })

  return Response.json({
    success: true,
    filename,
    counts: {
      posts: posts?.length,
      profiles: profiles?.length,
      reports: reports?.length,
    },
  })
}
