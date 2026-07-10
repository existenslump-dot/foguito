import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { getResend } from '@/lib/clients/resend'
import { logAudit } from '@/lib/auditLog'
import { renderEmail } from '@/lib/emails'
import { destroyCloudinaryAssets } from '@/lib/cloudinary.server'
import { collectPostAssetUrls } from '@/lib/post-assets'
import { isSameOrigin } from '@/lib/clients/same-origin'
import { getIdentityRetentionDays, purgeIdentityDocuments } from '@/lib/identity-retention'

export const runtime = 'nodejs'

export async function DELETE(req: Request) {
  if (!isSameOrigin(req)) {
    return Response.json({ error: 'Invalid origin' }, { status: 403 })
  }

  const supabase = getSupabaseAdmin()

  const token = req.headers.get('authorization')?.replace('Bearer ', '') || ''
  const {
    data: { user },
  } = await supabase.auth.getUser(token)

  if (!user) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }

  // 0. Fetch posts BEFORE deleting so we can gather Cloudinary URLs. Posts
  // delete cascades lose the URL references otherwise. Storage bill still
  // accrues if we skip this step.
  const { data: postsToWipe } = await supabase
    .from('posts')
    .select('image_urls, video_urls, video_url, audio_url, cover_video_url, thumbnail_url, id_doc_url')
    .eq('user_id', user.id)

  const assetUrls = Array.from(
    new Set(
      (postsToWipe ?? []).flatMap(p => collectPostAssetUrls(p as Parameters<typeof collectPostAssetUrls>[0])),
    ),
  )

  // 1. Delete posts
  await supabase.from('posts').delete().eq('user_id', user.id)

  // 2. Delete profile
  await supabase.from('profiles').delete().eq('id', user.id)

  // 3. Log deletion (hashed, no personal data)
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(user.email)
  )
  const emailHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Identity-document retention: schedule the purge of the user's private
  // `identity-documents/{userId}/` folder. Default 1 year after closure; when
  // IDENTITY_RETENTION_DAYS=0 we purge immediately and stamp identity_purged_at.
  const retentionDays = getIdentityRetentionDays()
  const now = new Date()
  const purgeImmediately = retentionDays === 0

  let identityPurgedAt: string | null = null
  if (purgeImmediately) {
    try {
      await purgeIdentityDocuments(supabase, user.id)
      identityPurgedAt = now.toISOString()
    } catch (err) {
      // Don't block account deletion on a storage hiccup — the row stays
      // unstamped so the retention cron retries the purge later.
      console.error('[account/delete] immediate identity purge failed:', err)
    }
  }

  const purgeAfter = new Date(now.getTime() + retentionDays * 86400000)

  await supabase.from('deletion_log').insert({
    user_id: user.id,
    email_hash: emailHash,
    deleted_at: now.toISOString(),
    reason: 'user_request',
    identity_purge_after: purgeAfter.toISOString(),
    identity_purged_at: identityPurgedAt,
  })

  // 4. Audit log
  await logAudit({
    userId: user.id,
    action: 'account_delete',
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
  })

  // 5. Fire-and-forget Cloudinary cleanup. Runs in parallel with auth
  // deletion so the user doesn't sit on a spinner while we tear through
  // dozens of assets. Failures are logged inside destroyCloudinaryAssets
  // (they won't throw).
  const cleanupPromise = assetUrls.length > 0
    ? destroyCloudinaryAssets(assetUrls).catch((err) => {
        console.error('[account/delete] cloudinary cleanup failed:', err)
        return { deleted: 0, failed: assetUrls }
      })
    : Promise.resolve({ deleted: 0, failed: [] })

  // 6. Delete auth user
  await supabase.auth.admin.deleteUser(user.id)

  // 7. Send confirmation email
  const resend = getResend()
  await resend.emails.send({
    from: 'Marketplace <noreply@example.com>',
    replyTo: 'contacto@example.com',
    to: user.email!,
    subject: 'Tu cuenta de Marketplace ha sido eliminada',
    html: renderEmail(`
      <h2 style="color:#2563EB">Cuenta Eliminada</h2>
      <p>Tu cuenta y todos tus datos han sido eliminados correctamente.</p>
      <p>Tienes 30 días para contactarnos si deseas recuperarla.</p>
    `),
  })

  const cleanupResult = await cleanupPromise
  return Response.json({ success: true, cleanup: cleanupResult })
}
