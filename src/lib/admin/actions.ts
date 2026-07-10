/**
 * Admin moderation actions — pure functions over a Supabase client.
 *
 * These were extracted from src/app/admin/page.tsx so the logic (approve /
 * reject / delete) can be tested in isolation with a mocked Supabase client.
 * Each function takes the client as its first argument and returns a
 * Result<T> discriminated union, so callers can consistently render success
 * toasts vs error state without wrapping every call in try/catch.
 *
 * Design rules:
 *   - No DOM, no state setters. The caller owns UI side-effects.
 *   - Every write goes through the passed-in client so tests don't need to
 *     mock the global `@/lib/supabase/client` module.
 *   - Row-level-security is enforced at the DB — these functions assume the
 *     caller already verified `is_admin = true` (which RLS also requires).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Result<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function toResult<T>(data: T | null, error: { message?: string } | null): Result<T> {
  if (error) return { ok: false, error: error.message || 'DB error' }
  return { ok: true, data: data as T }
}

export async function approveReview(
  supabase: SupabaseClient,
  reviewId: string,
): Promise<Result> {
  const { error } = await supabase
    .from('reviews')
    .update({
      status: 'pending_owner',
      admin_reviewed_at: new Date().toISOString(),
    })
    .eq('id', reviewId)
  if (!error) {
    void notifyAfterAdminApprove(supabase, reviewId)
  }
  return toResult(undefined, error)
}

export async function rejectReview(
  supabase: SupabaseClient,
  reviewId: string,
  reason?: string,
): Promise<Result> {
  const updates: Record<string, unknown> = {
    status: 'rejected_admin',
    admin_reviewed_at: new Date().toISOString(),
  }
  if (reason && typeof reason === 'string') {
    updates.admin_review_reason = reason.slice(0, 500)
  }
  const { error } = await supabase
    .from('reviews')
    .update(updates)
    .eq('id', reviewId)
  if (!error) {
    void notifyAfterAdminReject(supabase, reviewId, reason)
  }
  return toResult(undefined, error)
}

async function notifyAfterAdminApprove(supabase: SupabaseClient, reviewId: string) {
  try {
    const { data: review } = await supabase
      .from('reviews')
      .select('post_id, reviewer_id')
      .eq('id', reviewId)
      .maybeSingle()
    if (!review) return
    const [{ sendOwnerNewPendingReview, sendReviewerAdminApproved }, { getSupabaseAdmin }] = await Promise.all([
      import('@/lib/reviews-emails'),
      import('@/lib/clients/supabase-admin'),
    ])
    const admin = getSupabaseAdmin()
    const { data: post } = await admin
      .from('posts')
      .select('title, user_id')
      .eq('id', review.post_id)
      .maybeSingle<{ title: string | null; user_id: string }>()
    if (post?.user_id) {
      const { data: ownerUser } = await admin.auth.admin.getUserById(post.user_id)
      const ownerEmail = ownerUser?.user?.email
      if (ownerEmail) {
        await sendOwnerNewPendingReview({
          ownerEmail,
          postTitle: post.title || 'tu publicación',
        })
      }
    }
    if (review.reviewer_id) {
      const { data: reviewerUser } = await admin.auth.admin.getUserById(review.reviewer_id)
      const reviewerEmail = reviewerUser?.user?.email
      if (reviewerEmail) {
        await sendReviewerAdminApproved({
          reviewerEmail,
          postTitle: post?.title || 'la publicación',
        })
      }
    }
  } catch (err) {
    console.error('[notifyAfterAdminApprove] error (non-fatal)', err)
  }
}

async function notifyAfterAdminReject(supabase: SupabaseClient, reviewId: string, reason?: string) {
  try {
    const { data: review } = await supabase
      .from('reviews')
      .select('post_id, reviewer_id')
      .eq('id', reviewId)
      .maybeSingle()
    if (!review?.reviewer_id) return
    const [{ sendReviewerAdminRejected }, { getSupabaseAdmin }] = await Promise.all([
      import('@/lib/reviews-emails'),
      import('@/lib/clients/supabase-admin'),
    ])
    const admin = getSupabaseAdmin()
    const { data: reviewerUser } = await admin.auth.admin.getUserById(review.reviewer_id)
    const reviewerEmail = reviewerUser?.user?.email
    if (!reviewerEmail) return
    const { data: post } = await admin
      .from('posts')
      .select('title')
      .eq('id', review.post_id)
      .maybeSingle<{ title: string | null }>()
    await sendReviewerAdminRejected({
      reviewerEmail,
      postTitle: post?.title || 'la publicación',
      reason,
    })
  } catch (err) {
    console.error('[notifyAfterAdminReject] error (non-fatal)', err)
  }
}

export async function approveStory(
  supabase: SupabaseClient,
  storyId: string,
): Promise<Result> {
  const { error } = await supabase.from('stories').update({ status: 'approved' }).eq('id', storyId)
  return toResult(undefined, error)
}

export async function rejectStory(
  supabase: SupabaseClient,
  storyId: string,
  reason?: string | null,
): Promise<Result> {
  const { error } = await supabase.from('stories')
    .update({ status: 'rejected', rejection_reason: reason || null })
    .eq('id', storyId)
  return toResult(undefined, error)
}

export async function approveVerification(
  supabase: SupabaseClient,
  profileId: string,
): Promise<Result> {
  // Verification approval cascades to every post owned by the profile so
  // the ✓ badge shows on each card immediately.
  const { data, error: profileErr } = await supabase.from('profiles').update({
    verification_status: 'approved',
    identity_verified: true,
  }).eq('id', profileId).select('id')
  if (profileErr) return toResult(undefined, profileErr)
  if (!data || data.length === 0) {
    return { ok: false, error: 'No se pudo actualizar el perfil (sesión expirada o permisos insuficientes). Volvé a iniciar sesión e intentá de nuevo.' }
  }

  const { error: postsErr } = await supabase.from('posts').update({
    identity_verified: true,
    verification_status: 'approved',
  }).eq('user_id', profileId)
  return toResult(undefined, postsErr)
}

export async function rejectVerification(
  supabase: SupabaseClient,
  profileId: string,
  reason: string,
): Promise<Result> {
  if (!reason.trim()) {
    return { ok: false, error: 'Reason is required' }
  }
  const { data, error: profileErr } = await supabase.from('profiles').update({
    verification_status: 'rejected',
    verification_note: reason,
    identity_verified: false,
  }).eq('id', profileId).select('id')
  if (profileErr) return toResult(undefined, profileErr)
  if (!data || data.length === 0) {
    return { ok: false, error: 'No se pudo actualizar el perfil (sesión expirada o permisos insuficientes). Volvé a iniciar sesión e intentá de nuevo.' }
  }

  const { error: postsErr } = await supabase.from('posts').update({
    verification_status: 'rejected',
    identity_verified: false,
  }).eq('user_id', profileId)
  return toResult(undefined, postsErr)
}

// ── Reports ────────────────────────────────────────────────────────────

export async function dismissReport(
  supabase: SupabaseClient,
  reportId: string,
  options?: { adminId: string; note?: string },
): Promise<Result> {
  const payload: Record<string, unknown> = { status: 'dismissed' }
  if (options) {
    payload.actioned_by_admin_id = options.adminId || null
    payload.actioned_at = new Date().toISOString()
    payload.admin_note = options.note?.trim() || null
  }
  const { error } = await supabase.from('reports').update(payload).eq('id', reportId)
  return toResult(undefined, error)
}

export async function actionReport(
  supabase: SupabaseClient,
  reportId: string,
  options: { adminId: string; note: string },
): Promise<Result> {
  if (!options.note.trim()) return { ok: false, error: 'La nota es requerida para actuar un report' }
  const { error } = await supabase.from('reports')
    .update({
      status: 'actioned',
      actioned_by_admin_id: options.adminId || null,
      actioned_at: new Date().toISOString(),
      admin_note: options.note.trim(),
    })
    .eq('id', reportId)
  return toResult(undefined, error)
}

export async function deletePostFromReport(
  supabase: SupabaseClient,
  reportId: string,
  postId: string,
  options?: { adminId: string },
): Promise<Result> {
  const { error: postErr } = await supabase.from('posts').delete().eq('id', postId)
  if (postErr) return toResult(undefined, postErr)

  const reportPayload: Record<string, unknown> = options
    ? {
        status: 'actioned',
        actioned_by_admin_id: options.adminId || null,
        actioned_at: new Date().toISOString(),
        admin_note: 'Post eliminado desde el report',
      }
    : { status: 'reviewed' }
  const { error: reportErr } = await supabase.from('reports')
    .update(reportPayload)
    .eq('id', reportId)
  return toResult(undefined, reportErr)
}

export async function togglePostHidden(
  supabase: SupabaseClient,
  postId: string,
  nextHidden: boolean,
): Promise<Result> {
  const { error } = await supabase.from('posts')
    .update({ is_hidden: nextHidden }).eq('id', postId)
  return toResult(undefined, error)
}

export async function associatePostToUser(
  supabase: SupabaseClient,
  postId: string,
  userId: string,
): Promise<Result> {
  const { error } = await supabase.from('posts')
    .update({ user_id: userId }).eq('id', postId)
  return toResult(undefined, error)
}

export async function rejectPost(
  supabase: SupabaseClient,
  postId: string,
  reason: string,
): Promise<Result> {
  if (!reason.trim()) return { ok: false, error: 'Reason is required' }
  const { error } = await supabase.from('posts')
    .update({ status: 'rejected', is_approved: false, rejection_reason: reason })
    .eq('id', postId)
  return toResult(undefined, error)
}

export async function deletePost(
  supabase: SupabaseClient,
  postId: string,
): Promise<Result> {
  const { error } = await supabase.from('posts').delete().eq('id', postId)
  return toResult(undefined, error)
}

/**
 * Flip the `identity_verified` badge on a post. Separate from the full
 * identity-verification flow (which also touches id_document_url) — this is
 * the simpler manual toggle admins use from the post row.
 */
export async function togglePostVerified(
  supabase: SupabaseClient,
  postId: string,
  nextVerified: boolean,
): Promise<Result> {
  const { error } = await supabase.from('posts')
    .update({ identity_verified: nextVerified }).eq('id', postId)
  return toResult(undefined, error)
}

/**
 * Mark the post as verified after reviewing its uploaded id document.
 * Alias of togglePostVerified(postId, true) with its own name so the intent
 * reads clearly at callsites.
 */
export async function verifyPostWithId(
  supabase: SupabaseClient,
  postId: string,
): Promise<Result> {
  return togglePostVerified(supabase, postId, true)
}

/**
 * Reject the uploaded id document: clear the URL and flip the badge off.
 * The storage file itself is cleaned up by a DB trigger or an ops cron —
 * we don't touch storage here to keep the action pure and idempotent.
 */
export async function rejectPostIdDocument(
  supabase: SupabaseClient,
  postId: string,
): Promise<Result> {
  const { error } = await supabase.from('posts')
    .update({ identity_verified: false, id_document_url: null })
    .eq('id', postId)
  return toResult(undefined, error)
}
