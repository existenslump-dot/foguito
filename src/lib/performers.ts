import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { encryptString, decryptString } from './didit/crypto'

/**
 * `performers_2257` row helpers — the 18 U.S.C. § 2257 record-keeping layer.
 *
 * Every person appearing in content needs a 2257 record (legal name + ID doc +
 * verified DOB). Pilar #0 at the DB: `content_publish_guard` refuses to publish
 * any content unless EVERY linked performer has `is_complete = true`. This
 * module is the bridge between the three ways a record gets created/certified:
 *
 *   - createPerformer            — creator-facing collaborator registration.
 *   - ensureSelfPerformerFromDidit — the creator's OWN record, auto-completed
 *                                    by the Didit webhook once she's 18+.
 *   - completePerformer          — admin review of a collaborator.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ INVARIANTE #1 (pilar #0): la ruta creator-facing NUNCA setea               │
 * │ is_complete/dob_verified. SÓLO el webhook (self, veredicto Didit 18+) y el │
 * │ admin (completePerformer) los ponen en true. `createPerformer` los OMITE   │
 * │ a propósito — aunque corra con service-role no debe certificar nada.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * `legal_name_enc` reuses the KYC payload cipher (AES-256-GCM, DIDIT_PAYLOAD_KEY)
 * — `encryptString` on write, `decryptString` ONLY inside admin routes. The
 * decrypted legal name NEVER goes back to a non-admin client.
 *
 * The privileged columns (is_complete/dob_verified) are coerced to OLD/false by
 * `performers_2257_guard` unless the writer is admin OR service-role — so EVERY
 * write here MUST use the service-role admin client.
 */

const IDENTITY_BUCKET = 'identity-documents'

export type CreatePerformerResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

/**
 * Insert a performer 2257 record. Used by the creator-facing collaborator flow.
 *
 * ⚠️ INVARIANTE #1: OMITE is_complete y dob_verified del insert a propósito —
 * quedan en su default `false`. Aunque este helper corra con service-role (y por
 * tanto PODRÍA setearlos), NO certifica: sólo el admin/webhook lo hacen. Nada se
 * publica hasta que un admin lo complete (content_publish_guard).
 *
 * MUST be called with the service-role `admin` client.
 */
export async function createPerformer(
  admin: SupabaseClient,
  args: {
    addedBy: string
    legalName: string
    idDocPath: string
    custodian?: string | null
    diditSessionId?: string | null
  },
): Promise<CreatePerformerResult> {
  const { addedBy, legalName, idDocPath, custodian, diditSessionId } = args

  const { data, error } = await admin
    .from('performers_2257')
    .insert({
      added_by: addedBy,
      legal_name_enc: encryptString(legalName),
      id_doc_path: idDocPath,
      custodian: custodian ?? null,
      didit_session_id: diditSessionId ?? null,
      is_self: false,
      // NOTE: is_complete / dob_verified are DELIBERATELY OMITTED (default
      // false). This path never certifies a 2257 record — see INVARIANTE #1.
    })
    .select('id')
    .single<{ id: string }>()

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'insert failed' }
  }
  return { ok: true, id: data.id }
}

export type EnsureResult = { ok: boolean; error?: string }

/**
 * Idempotently create/refresh the creator's OWN 2257 record and CERTIFY it
 * (is_complete + dob_verified = true) off the back of a Didit 18+ verdict.
 *
 * Called only from the webhook (service-role → passes performers_2257_guard).
 * The unique partial index `(added_by) WHERE is_self` can't be a PostgREST
 * `on_conflict` arbiter (Postgres needs the WHERE predicate in the statement),
 * so we find-or-write by hand; the index is the race backstop. Best-effort /
 * non-fatal by design — content_publish_guard stays the real authority.
 *
 * If Didit didn't return a usable name we still create the self record (the 18+
 * verdict already certifies it) with an EMPTY legal name, encrypted — the admin
 * can complete the name later; the gate only cares about is_complete.
 *
 * MUST be called with the service-role `admin` client.
 */
export async function ensureSelfPerformerFromDidit(
  admin: SupabaseClient,
  userId: string,
  args: { legalName: string; sessionId?: string | null },
): Promise<EnsureResult> {
  const { legalName, sessionId } = args

  try {
    const patch = {
      added_by: userId,
      legal_name_enc: encryptString(legalName ?? ''),
      didit_session_id: sessionId ?? null,
      custodian: 'didit',
      is_self: true,
      // service-role → the guard lets these persist. This is the ONE self path
      // that certifies (the Didit 18+ verdict IS the certification).
      dob_verified: true,
      is_complete: true,
    }

    const { data: existing, error: selErr } = await admin
      .from('performers_2257')
      .select('id')
      .eq('added_by', userId)
      .eq('is_self', true)
      .maybeSingle<{ id: string }>()
    if (selErr) {
      console.error('[performers] ensureSelfPerformerFromDidit select failed (non-fatal)', selErr.message)
      return { ok: false, error: selErr.message }
    }

    if (existing) {
      const { error } = await admin
        .from('performers_2257')
        .update(patch)
        .eq('id', existing.id)
      if (error) {
        console.error('[performers] ensureSelfPerformerFromDidit update failed (non-fatal)', error.message)
        return { ok: false, error: error.message }
      }
      return { ok: true }
    }

    const { error } = await admin.from('performers_2257').insert(patch)
    if (error) {
      console.error('[performers] ensureSelfPerformerFromDidit insert failed (non-fatal)', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (err) {
    console.error('[performers] ensureSelfPerformerFromDidit unexpected error (non-fatal)', err)
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

/**
 * Certify a 2257 record complete (is_complete + dob_verified = true). This is
 * the admin review action — it's the ONLY way a collaborator record (added via
 * createPerformer) can be marked complete. MUST be admin/service-role.
 */
export async function completePerformer(
  admin: SupabaseClient,
  performerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await admin
    .from('performers_2257')
    .update({ is_complete: true, dob_verified: true })
    .eq('id', performerId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'performer not found' }
  return { ok: true }
}

/** Full 2257 record for admin review — legal name DECRYPTED, signed doc URL. */
export type PerformerReview = {
  id: string
  added_by: string | null
  legal_name: string
  id_doc_path: string | null
  doc_url: string | null
  custodian: string | null
  didit_session_id: string | null
  is_self: boolean
  is_complete: boolean
  dob_verified: boolean
  created_at: string
}

/**
 * Decrypt + sign a single 2257 record for the admin review panel.
 *
 * ⚠️ ADMIN ROUTES ONLY. The decrypted `legal_name` and the signed document URL
 * must NEVER reach a non-admin client. Returns null when the id doesn't exist.
 *
 * MUST be called with the service-role `admin` client.
 */
export async function getPerformerForReview(
  admin: SupabaseClient,
  performerId: string,
): Promise<PerformerReview | null> {
  const { data, error } = await admin
    .from('performers_2257')
    .select(
      'id, added_by, legal_name_enc, id_doc_path, custodian, didit_session_id, is_self, is_complete, dob_verified, created_at',
    )
    .eq('id', performerId)
    .maybeSingle<{
      id: string
      added_by: string | null
      legal_name_enc: string | null
      id_doc_path: string | null
      custodian: string | null
      didit_session_id: string | null
      is_self: boolean
      is_complete: boolean
      dob_verified: boolean
      created_at: string
    }>()

  if (error || !data) return null

  let legal_name = ''
  if (data.legal_name_enc) {
    try {
      legal_name = decryptString(data.legal_name_enc)
    } catch (e) {
      console.error('[performers] could not decrypt legal_name_enc:', e instanceof Error ? e.message : e)
    }
  }

  let doc_url: string | null = null
  if (data.id_doc_path) {
    const { data: signed } = await admin.storage
      .from(IDENTITY_BUCKET)
      .createSignedUrl(data.id_doc_path, 3600)
    doc_url = signed?.signedUrl ?? null
  }

  return {
    id: data.id,
    added_by: data.added_by,
    legal_name,
    id_doc_path: data.id_doc_path,
    doc_url,
    custodian: data.custodian,
    didit_session_id: data.didit_session_id,
    is_self: data.is_self,
    is_complete: data.is_complete,
    dob_verified: data.dob_verified,
    created_at: data.created_at,
  }
}

/** Safe (no legal name) 2257 record summary for lists. */
export type PerformerSummary = {
  id: string
  added_by: string | null
  custodian: string | null
  is_self: boolean
  is_complete: boolean
  dob_verified: boolean
  created_at: string
}

const SUMMARY_COLS = 'id, added_by, custodian, is_self, is_complete, dob_verified, created_at'

/** List a creator's own 2257 records (owner-scoped read; no decrypted PII). */
export async function listPerformersForOwner(
  client: SupabaseClient,
  userId: string,
): Promise<{ ok: true; performers: PerformerSummary[] } | { ok: false; error: string }> {
  const { data, error } = await client
    .from('performers_2257')
    .select(SUMMARY_COLS)
    .eq('added_by', userId)
    .order('created_at', { ascending: false })
  if (error) return { ok: false, error: error.message }
  return { ok: true, performers: (data ?? []) as PerformerSummary[] }
}

/**
 * List every 2257 record still pending certification (the admin review queue).
 * SAFE fields only — the legal name stays encrypted here; it is decrypted ONLY
 * in getPerformerForReview (per-id admin route). MUST be admin/service-role.
 */
export async function listIncompletePerformers(
  admin: SupabaseClient,
): Promise<{ ok: true; performers: PerformerSummary[] } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('performers_2257')
    .select(SUMMARY_COLS)
    .eq('is_complete', false)
    .order('created_at', { ascending: false })
  if (error) return { ok: false, error: error.message }
  return { ok: true, performers: (data ?? []) as PerformerSummary[] }
}
