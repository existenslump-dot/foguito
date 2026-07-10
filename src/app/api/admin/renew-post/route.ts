import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { AdminRenewPostSchema, validationError } from '@/lib/validation/schemas'
import { recordAudit } from '@/lib/audit'
import { MARKETPLACE } from '@/config/marketplace.config'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const gate = await requireAdmin(req)
    if (!gate.ok) return gate.response

    const admin = getSupabaseAdmin()
    const parsed = AdminRenewPostSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 })
    }
    const { postId, days } = parsed.data

    const { data: post, error: postErr } = await admin
      .from('posts')
      .select('id, expires_at, user_id, countries(slug)')
      .eq('id', postId)
      .single()
    if (postErr || !post) {
      return NextResponse.json({ error: 'Publicación no encontrada' }, { status: 404 })
    }

    const now = Date.now()
    const baseMs = post.expires_at ? new Date(post.expires_at).getTime() : now
    const newExpiry = new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString()

    const { error: updErr } = await admin
      .from('posts')
      .update({ expires_at: newExpiry })
      .eq('id', post.id)
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    const countriesRel = post.countries as
      | { slug?: string | null }
      | Array<{ slug?: string | null }>
      | null
      | undefined
    const countrySlug = Array.isArray(countriesRel)
      ? countriesRel[0]?.slug
      : countriesRel?.slug
    revalidatePath(`/${countrySlug ?? MARKETPLACE.market.defaultCountrySlug}`, 'layout')

    void recordAudit({
      eventType: 'post_renewed',
      actorRole: 'admin',
      actorUserId: gate.userId,
      subjectType: 'post',
      subjectId: post.id,
      req,
      metadata: {
        post_owner_user_id: post.user_id,
        days_added: days,
        previous_expires_at: post.expires_at,
        new_expires_at: newExpiry,
      },
    })

    return NextResponse.json({ success: true, expiresAt: newExpiry })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error desconocido' },
      { status: 500 },
    )
  }
}
