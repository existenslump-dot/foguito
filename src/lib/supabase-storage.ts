import { createClient } from '@supabase/supabase-js'

/*
 * Private bucket: identity-documents
 *
 * The bucket's RLS policies are managed by migration:
 * supabase/migrations/20260521120000_identity_documents_owner_policy.sql
 *
 * Model: an authenticated user reads/writes ONLY their own `{auth.uid()}/`
 * folder; admins access other users' documents via service-role in the
 * /api/admin/identity-* routes (which bypass RLS).
 */

// NOTE: dedicated client for storage ops — uses service role when available.
// Do NOT replace with the shared browser singleton (that one uses anon key only).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

/**
 * Upload an identity document for a user.
 * Path: identity-documents/{userId}/{filename}
 */
export async function uploadIdentityDoc(
  userId: string,
  file: File
): Promise<{ path: string | null; error: string | null }> {
  const ext  = file.name.split('.').pop() ?? 'bin'
  const path = `${userId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('identity-documents')
    .upload(path, file, { upsert: false, contentType: file.type })

  if (error) return { path: null, error: error.message }
  return { path, error: null }
}

/**
 * Get a signed URL for an identity document (expires in 60 minutes).
 */
export async function getIdentityDocUrl(
  userId: string,
  filename: string
): Promise<string | null> {
  const path = `${userId}/${filename}`
  const { data, error } = await supabase.storage
    .from('identity-documents')
    .createSignedUrl(path, 60 * 60) // 60 minutes

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
