import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { AdminApprovePostSchema, validationError } from '@/lib/validation/schemas'
import { submitIndexNow } from '@/lib/indexnow'
import { postCanonicalPath } from '@/lib/post-url'
import { BASE_URL } from '@/lib/seo'
import { recordAudit } from '@/lib/audit'
import { resolvePostDurationDays } from '@/lib/subscriptions'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const gate = await requireAdmin(req)
    if (!gate.ok) return gate.response

    const admin = getSupabaseAdmin()
    const parsed = AdminApprovePostSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 })
    }
    const { postId } = parsed.data

    const { data: post, error: postErr } = await admin
      .from('posts').select('id, tier, user_id, status, parent_post_id').eq('id', postId).single()
    if (postErr || !post) {
      return NextResponse.json({ error: 'Publicación no encontrada' }, { status: 404 })
    }

    // Concierge mode: credits are hidden from the UI. Approve → publish
    // without any credit deduction. The downstream 'deduct credits' block
    // is kept as a no-op so the JSON response shape stays stable.
    const chargeAmount = 0

    // Post lifetime follows the owner's active subscription (15/30 days,
    // whichever package they bought); default when they have none.
    const durationDays = await resolvePostDurationDays(admin, post.user_id)

    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString()

    if (post.status === 'revision' && post.parent_post_id) {
      const { data: sourcePost } = await admin.from('posts').select('*').eq('id', postId).single()
      if (sourcePost) {
        await admin.from('posts').update({
          title: sourcePost.title, description: sourcePost.description, price: sourcePost.price,
          whatsapp_number: sourcePost.whatsapp_number,
          country_id: sourcePost.country_id,
          provincia_id: sourcePost.provincia_id,
          comuna_id: sourcePost.comuna_id,
          barrio_id: sourcePost.barrio_id,
          image_urls: sourcePost.image_urls, video_urls: sourcePost.video_urls,
          audio_url: sourcePost.audio_url, audio_filename: sourcePost.audio_filename,
          category: sourcePost.category, tier: sourcePost.tier,
          cover_video_url: sourcePost.cover_video_url || null,
          profile_photo_url: sourcePost.profile_photo_url || null,
          attributes: sourcePost.attributes ?? {},
          localidad: sourcePost.localidad,
          status: 'published', is_approved: true, rejection_reason: null,
          published_at: now, expires_at: expiresAt,
        }).eq('id', post.parent_post_id)
      }
      await admin.from('posts').delete().eq('id', post.id)
    } else {
      const { error: updErr } = await admin.from('posts').update({
        status: 'published', is_approved: true, rejection_reason: null,
        published_at: now, expires_at: expiresAt,
      }).eq('id', post.id)
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    let creditsDeducted = 0
    let newCreditsBalance: number | null = null
    if (chargeAmount > 0 && post.user_id) {
      const { data: profile } = await admin
        .from('profiles').select('credits').eq('id', post.user_id).single()
      const currentCredits = profile?.credits ?? 0
      const newCredits = Math.max(0, currentCredits - chargeAmount)
      const { error: creditErr } = await admin
        .from('profiles').update({ credits: newCredits }).eq('id', post.user_id)
      if (creditErr) {
        return NextResponse.json({ error: 'Error deduciendo créditos: ' + creditErr.message }, { status: 500 })
      }
      creditsDeducted = chargeAmount
      newCreditsBalance = newCredits
    }

    // Fire-and-forget: nudge Bing + Yandex to re-crawl the canonical URL
    // minutes after approval instead of hours. Wrapped in a try so a
    // crawler-ping hiccup never masks a successful publication — we've
    // already persisted the status change above.
    const publishedPostId = post.status === 'revision' && post.parent_post_id
      ? post.parent_post_id
      : post.id
    const { data: published } = await admin
      .from('posts')
      .select('id, title, post_slug, category, countries(slug), provincias(slug), comunas(slug)')
      .eq('id', publishedPostId)
      .maybeSingle()

    if (published) {
      const url = `${BASE_URL}${postCanonicalPath(published)}`
      void submitIndexNow([url]).catch(() => {})
    }

    void recordAudit({
      eventType: 'post_approved',
      actorRole: 'admin',
      actorUserId: gate.userId,
      subjectType: 'post',
      subjectId: publishedPostId,
      req,
      metadata: {
        post_owner_user_id: post.user_id,
        was_revision: post.status === 'revision',
        ...(post.parent_post_id ? { parent_post_id: post.parent_post_id } : {}),
      },
    })

    return NextResponse.json({
      success: true,
      creditsDeducted,
      newCreditsBalance,
    })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Error desconocido',
    }, { status: 500 })
  }
}
