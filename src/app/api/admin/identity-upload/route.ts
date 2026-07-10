import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'

/**
 * POST /api/admin/identity-upload
 *
 * Admin-only endpoint to upload identity verification documents on behalf of
 * a user.
 *
 * Why a server endpoint (not direct SDK from the client):
 *   The `identity-documents` Supabase Storage bucket has a per-user RLS
 *   policy ("user can write to `{auth.uid()}/*`"). The admin uploading on
 *   behalf of `target_user_id` would 403 against that policy because
 *   `auth.uid() !== target_user_id`. Service-role client bypasses RLS,
 *   keeping the user-facing bucket policy intact and centralizing the
 *   admin write in one auditable endpoint.
 */

export const runtime = 'nodejs'

// Mirror /dashboard/verify and src/lib/upload-validation.ts limits so an
// admin upload can't sneak through a 50 MB JPG that the regular user flow
// would reject.
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime'])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requireAdmin(req)
    if (!gate.ok) return gate.response

    const admin = getSupabaseAdmin()
    const form = await req.formData()

    const targetUserId = String(form.get('target_user_id') ?? '').trim()
    if (!UUID_RE.test(targetUserId)) {
      return err('target_user_id inválido (UUID esperado)')
    }

    const docFile    = form.get('doc')    as File | null
    const selfieFile = form.get('selfie') as File | null
    const videoFile  = form.get('video')  as File | null

    if (!docFile || (!selfieFile && !videoFile)) {
      return err('Falta el documento o la prueba de vida: doc + (selfie o video)')
    }

    const imagesToCheck: [string, File][] = [['doc', docFile]]
    if (selfieFile) imagesToCheck.push(['selfie', selfieFile])
    for (const [label, f] of imagesToCheck) {
      if (!IMAGE_MIMES.has(f.type)) {
        return err(`${label}: tipo no permitido (${f.type}). Usa JPG/PNG/WebP.`)
      }
      if (f.size > MAX_IMAGE_SIZE_BYTES) {
        return err(`${label}: excede ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB`)
      }
    }
    if (videoFile) {
      if (!VIDEO_MIMES.has(videoFile.type)) {
        return err(`video: tipo no permitido (${videoFile.type}). Usa MP4/WebM/MOV.`)
      }
      if (videoFile.size > MAX_VIDEO_SIZE_BYTES) {
        return err(`video: excede ${MAX_VIDEO_SIZE_BYTES / 1024 / 1024} MB`)
      }
    }

    const { data: targetProfile, error: profileFetchErr } = await admin
      .from('profiles')
      .select('id')
      .eq('id', targetUserId)
      .maybeSingle()
    if (profileFetchErr) return err(profileFetchErr.message, 500)
    if (!targetProfile) return err('Usuario destino no existe', 404)

    const docExt = (docFile.name.split('.').pop() || 'jpg').toLowerCase()
    const docPath = `${targetUserId}/id_doc.${docExt}`

    const uploadOps = [
      admin.storage.from('identity-documents').upload(docPath, docFile, { upsert: true, contentType: docFile.type }),
    ]

    let selfiePath: string | null = null
    if (selfieFile) {
      const selfieExt = (selfieFile.name.split('.').pop() || 'jpg').toLowerCase()
      selfiePath = `${targetUserId}/id_selfie.${selfieExt}`
      uploadOps.push(admin.storage.from('identity-documents').upload(selfiePath, selfieFile, { upsert: true, contentType: selfieFile.type }))
    }

    let videoPath: string | null = null
    if (videoFile) {
      const videoExt = (videoFile.name.split('.').pop() || 'mp4').toLowerCase()
      videoPath = `${targetUserId}/id_video.${videoExt}`
      uploadOps.push(admin.storage.from('identity-documents').upload(videoPath, videoFile, { upsert: true, contentType: videoFile.type }))
    }

    const uploads = await Promise.all(uploadOps)
    for (const u of uploads) {
      if (u.error) return err(`Storage upload failed: ${u.error.message}`, 500)
    }

    const { error: profileUpdErr } = await admin.from('profiles').update({
      identity_doc_url:     docPath,
      identity_selfie_url:  selfiePath,
      identity_video_url:   videoPath,
      verification_status:  'approved',
      identity_verified:    true,
    }).eq('id', targetUserId)
    if (profileUpdErr) return err(`Profile update failed: ${profileUpdErr.message}`, 500)

    const { error: postsUpdErr } = await admin.from('posts').update({
      identity_verified:   true,
      verification_status: 'approved',
    }).eq('user_id', targetUserId)
    if (postsUpdErr) {
      // Profile already flipped — log the cascade failure but return success
      // so the admin sees the verify worked at the user level. The post
      // badges will re-sync on next /admin/approve-post call regardless.
      console.error('[identity-upload] posts cascade failed:', postsUpdErr.message)
    }

    return NextResponse.json({
      success: true,
      paths: { doc: docPath, selfie: selfiePath, video: videoPath },
    })
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'Error desconocido',
    }, { status: 500 })
  }
}
