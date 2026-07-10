import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Identity-document retention helpers.
 *
 * Identity documents (DNI/passport photo, selfie, verification video) are
 * uploaded to the PRIVATE Supabase Storage bucket `identity-documents` under
 * `{userId}/...` (see src/lib/supabase-storage.ts). Privacy policy promises we
 * keep them at most one year after the account is closed; this module performs
 * the actual purge.
 *
 * `purgeIdentityDocuments` lists every object under the user's folder, removes
 * them from the bucket, and nulls the three identity URL columns on `profiles`
 * (only matters while the row still exists — on full account deletion the row
 * is already gone, so the UPDATE is a harmless no-op).
 */

const IDENTITY_BUCKET = 'identity-documents'

/**
 * Retention window (in days) before a closed account's identity documents are
 * purged. Configurable via `IDENTITY_RETENTION_DAYS`; defaults to 365 (1 year).
 * A value of `0` means "purge immediately on account deletion".
 */
export function getIdentityRetentionDays(): number {
  const raw = process.env.IDENTITY_RETENTION_DAYS
  if (raw === undefined || raw === '') return 365
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return 365
  return Math.floor(parsed)
}

export interface PurgeIdentityResult {
  removed: number
}

/**
 * Delete all identity documents for a user and null the URL columns on their
 * profile row (if it still exists).
 *
 * Handles an empty/missing folder gracefully — returns `{ removed: 0 }` without
 * throwing. Uses the service-role admin client (bypasses RLS / private bucket).
 */
export async function purgeIdentityDocuments(
  admin: SupabaseClient,
  userId: string,
): Promise<PurgeIdentityResult> {
  const bucket = admin.storage.from(IDENTITY_BUCKET)

  // 1. List everything under `{userId}/`. The folder may not exist (user never
  // uploaded) — Supabase returns an empty list rather than an error.
  const { data: files, error: listError } = await bucket.list(userId)
  if (listError) {
    throw new Error(`[identity-retention] list failed: ${listError.message}`)
  }

  const paths = (files ?? [])
    // `list` can return folder placeholders (name === null / empty); skip them.
    .filter((f) => Boolean(f?.name))
    .map((f) => `${userId}/${f.name}`)

  // 2. Remove the objects. Empty folder ⇒ nothing to do.
  if (paths.length > 0) {
    const { error: removeError } = await bucket.remove(paths)
    if (removeError) {
      throw new Error(`[identity-retention] remove failed: ${removeError.message}`)
    }
  }

  // 3. Null the identity URL columns on the profile if the row still exists.
  // On full account deletion the profile is already gone, so this matches 0
  // rows — that's fine, we don't treat it as an error.
  await admin
    .from('profiles')
    .update({
      identity_doc_url: null,
      identity_selfie_url: null,
      identity_video_url: null,
    })
    .eq('id', userId)

  return { removed: paths.length }
}
