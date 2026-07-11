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
 * Sub-prefix under `{userId}/` that holds 2257 record-keeping documents
 * (`{userId}/performers/**`). These are EXCLUDED from the account-closure purge:
 * 2257 producer records carry a long legal retention window (18 U.S.C. § 2257)
 * that is independent of the account's lifetime. We must not delete them here.
 */
const PERFORMERS_2257_PREFIX = 'performers'

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
    // NEVER purge 2257 documents: `{userId}/performers/**` has a long legal
    // retention window (18 U.S.C. § 2257) independent of account closure. It
    // surfaces here as a single `performers` folder entry (list is non-
    // recursive); skipping it leaves the whole sub-tree untouched.
    // Match defensivo (fail-closed para docs de retención legal): normalizamos
    // barra final + casing antes de comparar, para que un cambio de formato del
    // listado de Supabase no borre por accidente el subárbol 2257.
    .filter((f) => f.name.replace(/\/+$/, '').toLowerCase() !== PERFORMERS_2257_PREFIX)
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

/**
 * Purge a user's consumer age-gate verifications (PII minimization, pilar #0).
 *
 * `age_gate_verifications` holds only method/jurisdiction/verified_at/expires_at
 * (never DOB/name/document — the webhook discards those), but it is still
 * account-linked data we shouldn't keep past account closure. On FULL account
 * deletion the `user_id -> auth.users ON DELETE CASCADE` already wipes these
 * rows; this helper covers the closed-but-retained window (deletion_log) where
 * the auth user may still exist. Uses the service-role admin client (bypasses
 * RLS). Empty/no rows ⇒ `{ removed: 0 }`, never throws for "nothing to do".
 */
export async function purgeAgeGateVerifications(
  admin: SupabaseClient,
  userId: string,
): Promise<PurgeIdentityResult> {
  const { data, error } = await admin
    .from('age_gate_verifications')
    .delete()
    .eq('user_id', userId)
    .select('id')
  if (error) {
    throw new Error(`[identity-retention] age-gate purge failed: ${error.message}`)
  }
  return { removed: data?.length ?? 0 }
}
