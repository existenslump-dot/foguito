import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCsamProvider } from './index'
import { isCsamEnabled, isProduction } from './config'
import type { CsamScanResult } from './provider'
import { getNcmecReporter, type NcmecIncident } from './ncmec'
import { recordAudit } from '@/lib/audit'

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline de escaneo CSAM (pilar #0). TODO escribe por SERVICE-ROLE.
// ─────────────────────────────────────────────────────────────────────────────
//
// INVARIANTES (repetidas en el código):
//   · TODO el pipeline escribe con getSupabaseAdmin() (service-role). Si no,
//     content_guard_privileged COACCIONA csam_status/status a OLD/default en
//     silencio → el escaneo no persistiría. applyPass RE-LEE y verifica.
//   · Nada publica sin csam_status='pass'. Error/veredicto desconocido =
//     FAIL-CLOSED: csam_status queda 'pending' y la fila vuelve a 'uploaded'
//     para que el cron la reintente. NUNCA auto-pass.
//   · 'possible minor' = HIT DURO (bloqueo + preservación + reporte), no 'review'.
//   · Un media 'blocked' NUNCA es accesible ni re-escaneable por la creadora:
//     bucket deny-all + status='removed' + claim atómico + terminal-check.
//   · Ante un hit: PRESERVAR + REGISTRAR ANTES de cualquier otra cosa; nunca
//     borrar el media del hit; el reporte NCMEC con estado durable + retry.
// ─────────────────────────────────────────────────────────────────────────────

const CONTENT_BUCKET = 'creator-content'
const EVIDENCE_BUCKET = 'csam-evidence'
const CONTENT_SCAN_COLS = 'id, creator_id, media_ref, media_type, status, csam_status'

type ContentRow = {
  id: string
  creator_id: string
  media_ref: string | null
  media_type: string | null
  status: string
  csam_status: string
}

export type ScanOutcome =
  | { ok: true; status: 'pass' | 'review' | 'blocked' | 'skipped'; reason?: string }
  | { ok: false; status: 'error'; reason: string }

/**
 * Claim atómico para escanear: `status='uploaded' → 'csam_scanning'` en un solo
 * UPDATE condicional. Devuelve true si ESTA invocación ganó el claim (filas
 * afectadas > 0). Previene doble-proceso (dos crons/instancias) y re-trigger por
 * la creadora. MUST service-role (el guard coacciona status para no-service).
 */
export async function claimForScan(
  admin: SupabaseClient,
  contentId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('content')
    .update({ status: 'csam_scanning' })
    .eq('id', contentId)
    .eq('status', 'uploaded') // claim atómico: solo si sigue 'uploaded'
    .select('id')
  if (error) {
    console.error('[csam/scan] claim failed for', contentId, error.message)
    return false
  }
  return Array.isArray(data) && data.length > 0
}

/**
 * FAIL-CLOSED requeue: devuelve la fila a 'uploaded' (solo si sigue en
 * 'csam_scanning') para que el cron la re-claimee y re-escanee. csam_status
 * queda 'pending' — nada publica. El `.eq('status','csam_scanning')` evita
 * "des-bloquear" una fila que un hit ya movió a 'removed'.
 */
async function requeueForRetry(admin: SupabaseClient, contentId: string): Promise<void> {
  await admin
    .from('content')
    .update({ status: 'uploaded' })
    .eq('id', contentId)
    .eq('status', 'csam_scanning')
}

/**
 * Escanea una pieza reclamada y aplica el veredicto. Idempotente: si la fila no
 * está en 'csam_scanning' (ya terminal / no reclamada) → no-op.
 *
 * MUST llamarse con el service-role `admin` client.
 */
export async function scanAndApply(
  admin: SupabaseClient,
  contentId: string,
): Promise<ScanOutcome> {
  const { data: row, error } = await admin
    .from('content')
    .select(CONTENT_SCAN_COLS)
    .eq('id', contentId)
    .maybeSingle<ContentRow>()

  if (error) return { ok: false, status: 'error', reason: error.message }
  if (!row) return { ok: false, status: 'error', reason: 'content not found' }

  // Idempotencia: solo actuamos sobre filas EN escaneo. Cualquier otro estado
  // (uploaded sin claim, in_review, published, rejected, removed) → no-op.
  if (row.status !== 'csam_scanning') {
    return { ok: true, status: 'skipped', reason: `status=${row.status}` }
  }

  try {
    const result = await getCsamProvider().scan({
      contentId: row.id,
      mediaRef: row.media_ref ?? '',
      mediaType: row.media_type ?? '',
    })

    // Orden deliberado: 'possible minor' o 'blocked' → HIT DURO ANTES que
    // cualquier pass. Un veredicto contradictorio (pass + possible_minor) se
    // trata como hit — la protección del menor prevalece siempre.
    if (result.matchType === 'classifier_possible_minor' || result.verdict === 'blocked') {
      await handleHit(admin, row, result)
      return { ok: true, status: 'blocked' }
    }
    if (result.verdict === 'pass') {
      await applyPass(admin, row, result)
      return { ok: true, status: 'pass' }
    }
    if (result.verdict === 'review') {
      await applyReview(admin, row, result)
      return { ok: true, status: 'review' }
    }

    // Veredicto desconocido → fail-closed (requeue + reintento por cron).
    throw new Error(`unknown verdict "${String(result.verdict)}"`)
  } catch (err) {
    // FAIL-CLOSED: NO cambiamos csam_status (queda 'pending'); devolvemos la
    // fila a 'uploaded' para que el cron la reintente. Nunca auto-pass.
    const reason = err instanceof Error ? err.message : 'scan error'
    console.error('[csam/scan] scanAndApply failed for', contentId, reason)
    await requeueForRetry(admin, contentId)
    void recordAudit({
      eventType: 'csam_scan_error',
      actorRole: 'system',
      subjectType: 'content',
      subjectId: contentId,
      metadata: { reason },
    })
    return { ok: false, status: 'error', reason }
  }
}

/**
 * PASS: csam_status='pass' + status='in_review'. RE-LEE y confirma que
 * csam_status persistió — si no, es señal de que NO se usó service-role
 * (content_guard_privileged coaccionó a OLD) → tirar (fail-closed).
 */
async function applyPass(
  admin: SupabaseClient,
  row: ContentRow,
  result: CsamScanResult,
): Promise<void> {
  // FAIL-CLOSED (belt-and-suspenders del guard del stub): en producción NUNCA
  // certificamos un 'pass' sin vendor real. Tirar acá cae en el catch de
  // scanAndApply → requeue → la pieza queda 'pending' y no se publica. El stub
  // ya tira en prod; esto cubre cualquier proveedor que emitiera un pass indebido.
  if (!isCsamEnabled() && isProduction()) {
    throw new Error(
      '[csam] refusing to certify pass in production without a real CSAM vendor (fail-closed)',
    )
  }
  const { error } = await admin
    .from('content')
    .update({ csam_status: 'pass', status: 'in_review', csam_scanned_at: new Date().toISOString() })
    .eq('id', row.id)
  if (error) throw new Error(`applyPass update failed: ${error.message}`)

  // Verificación de persistencia: prueba que el service-role escribió a través
  // del guard. Si volviera 'pending', el pipeline no está corriendo con
  // service-role — abortamos para NO dejar la pieza en un pass fantasma.
  const { data: check, error: reErr } = await admin
    .from('content')
    .select('csam_status, status')
    .eq('id', row.id)
    .maybeSingle<{ csam_status: string; status: string }>()
  if (reErr) throw new Error(`applyPass re-read failed: ${reErr.message}`)
  if (check?.csam_status !== 'pass') {
    throw new Error(
      'applyPass: csam_status did NOT persist (esperado "pass"). ' +
        'El pipeline DEBE correr con service-role — content_guard_privileged revirtió la escritura.',
    )
  }

  void recordAudit({
    eventType: 'csam_scan_pass',
    actorRole: 'system',
    subjectType: 'content',
    subjectId: row.id,
    metadata: { provider: result.provider, score: result.score ?? null },
  })
}

/**
 * REVIEW (ambiguo, NO menor): status='in_review' dejando csam_status='pending'.
 * NUNCA auto-pass — la revisión humana decide. content_publish_guard sigue
 * bloqueando la publicación mientras csam_status != 'pass'.
 */
async function applyReview(
  admin: SupabaseClient,
  row: ContentRow,
  result: CsamScanResult,
): Promise<void> {
  const { error } = await admin
    .from('content')
    .update({ status: 'in_review' }) // csam_status queda 'pending' a propósito
    .eq('id', row.id)
  if (error) throw new Error(`applyReview update failed: ${error.message}`)

  void recordAudit({
    eventType: 'csam_scan_review',
    actorRole: 'system',
    subjectType: 'content',
    subjectId: row.id,
    metadata: { provider: result.provider, score: result.score ?? null },
  })
}

/**
 * HIT (blocked / possible_minor) — EN ORDEN FAIL-CLOSED:
 *   1. PRESERVAR evidencia PRIMERO (download del original → upload a
 *      csam-evidence). NUNCA borrar el original. Si falla → ABORTAR (throw): no
 *      se marca nada; el cron reintenta el hit completo.
 *   2. Insertar csam_incidents (durable; find-or-create, sin duplicar).
 *   3. Bloqueo duro: content.csam_status='blocked', status='removed'.
 *   4. Auditar (sin bytes ni PII — solo refs).
 *   5. Reporte NCMEC con estado durable; fallo → 'failed' (el cron lo reintenta).
 *      El fallo del reporte NUNCA revierte el bloqueo ni tira fuera de handleHit.
 *
 * Idempotente: si ya hay incidente para ese content, se reusa (no se duplica).
 * MUST service-role.
 */
async function handleHit(
  admin: SupabaseClient,
  row: ContentRow,
  result: CsamScanResult,
): Promise<void> {
  // ── 1. PRESERVAR EVIDENCIA PRIMERO (fail-closed). ────────────────────────
  const evidencePath = row.media_ref ? `${row.creator_id}/${row.id}/media` : null
  if (row.media_ref && evidencePath) {
    const dl = await admin.storage.from(CONTENT_BUCKET).download(row.media_ref)
    if (dl.error || !dl.data) {
      // ABORTAR: sin preservar no marcamos nada que habilite cleanup. Reintento.
      throw new Error(
        `handleHit: evidence preservation DOWNLOAD failed (${dl.error?.message ?? 'empty body'}) — abort, no block applied`,
      )
    }
    const blob = dl.data as Blob
    const up = await admin.storage
      .from(EVIDENCE_BUCKET)
      .upload(evidencePath, blob, {
        upsert: true, // idempotente ante reintentos del mismo hit
        contentType: blob.type || 'application/octet-stream',
      })
    if (up.error) {
      throw new Error(`handleHit: evidence preservation UPLOAD failed (${up.error.message}) — abort, no block applied`)
    }
  }
  // Auditar la preservación ANTES de bloquear (refs, nunca bytes/PII).
  void recordAudit({
    eventType: 'csam_evidence_preserved',
    actorRole: 'system',
    subjectType: 'content',
    subjectId: row.id,
    metadata: { evidence_path: evidencePath, provider: result.provider },
  })

  // ── 2. INCIDENTE DURABLE (find-or-create, sin duplicar). ─────────────────
  let incidentId: string
  let alreadyReported = false
  const existing = await admin
    .from('csam_incidents')
    .select('id, ncmec_status')
    .eq('content_id', row.id)
    .maybeSingle<{ id: string; ncmec_status: string }>()

  if (existing.data) {
    incidentId = existing.data.id
    alreadyReported = existing.data.ncmec_status === 'reported'
  } else {
    const ins = await admin
      .from('csam_incidents')
      .insert({
        content_id: row.id,
        creator_id: row.creator_id,
        media_ref: row.media_ref,
        evidence_path: evidencePath,
        verdict: result.verdict,
        match_type: result.matchType ?? null,
        score: result.score ?? null,
        provider: result.provider,
        ncmec_status: 'pending',
      })
      .select('id')
      .single<{ id: string }>()

    if (ins.error) {
      // Carrera: el índice único (content_id) rebotó (23505) → reusar el existente.
      if (ins.error.code === '23505') {
        const re = await admin
          .from('csam_incidents')
          .select('id, ncmec_status')
          .eq('content_id', row.id)
          .maybeSingle<{ id: string; ncmec_status: string }>()
        if (!re.data) throw new Error('handleHit: incident conflict but row not found')
        incidentId = re.data.id
        alreadyReported = re.data.ncmec_status === 'reported'
      } else {
        throw new Error(`handleHit: incident insert failed: ${ins.error.message}`)
      }
    } else {
      incidentId = ins.data.id
    }
  }

  // ── 3. BLOQUEO DURO. ─────────────────────────────────────────────────────
  const blk = await admin
    .from('content')
    .update({ csam_status: 'blocked', status: 'removed', csam_scanned_at: new Date().toISOString() })
    .eq('id', row.id)
  if (blk.error) throw new Error(`handleHit: block update failed: ${blk.error.message}`)

  // ── 4. AUDITAR el bloqueo (refs, nunca bytes/PII). ───────────────────────
  void recordAudit({
    eventType: 'csam_hit_blocked',
    actorRole: 'system',
    subjectType: 'content',
    subjectId: row.id,
    metadata: {
      incident_id: incidentId,
      verdict: result.verdict,
      match_type: result.matchType ?? null,
      provider: result.provider,
    },
  })

  // ── 5. REPORTE NCMEC (durable + retry). NUNCA revierte el bloqueo. ───────
  if (!alreadyReported) {
    await reportIncidentToNcmec(admin, {
      incidentId,
      contentId: row.id,
      creatorId: row.creator_id,
      verdict: result.verdict,
      matchType: result.matchType ?? null,
      provider: result.provider,
      evidencePath,
    })
  }
}

/**
 * Reporta un incidente a NCMEC y persiste el resultado en `csam_incidents`. NO
 * tira: un fallo transitorio deja ncmec_status='failed' y el cron de retry lo
 * reintenta (el reporte obligatorio no se pierde). Reutilizable por el cron.
 *
 * MUST service-role.
 */
export async function reportIncidentToNcmec(
  admin: SupabaseClient,
  incident: NcmecIncident,
): Promise<{ ok: boolean }> {
  try {
    const rep = await getNcmecReporter().report(incident)
    if (rep.ok) {
      await admin
        .from('csam_incidents')
        .update({
          ncmec_status: 'reported',
          ncmec_report_id: rep.reportId ?? null,
          reported_at: new Date().toISOString(),
        })
        .eq('id', incident.incidentId)
      void recordAudit({
        eventType: 'csam_ncmec_reported',
        actorRole: 'system',
        subjectType: 'content',
        subjectId: incident.contentId,
        metadata: { incident_id: incident.incidentId, report_id: rep.reportId ?? null },
      })
      return { ok: true }
    }
    // Reporte rechazado (no-throw) → durable 'failed' + retry por cron.
    await admin.from('csam_incidents').update({ ncmec_status: 'failed' }).eq('id', incident.incidentId)
    void recordAudit({
      eventType: 'csam_ncmec_failed',
      actorRole: 'system',
      subjectType: 'content',
      subjectId: incident.contentId,
      metadata: { incident_id: incident.incidentId, error: rep.error ?? 'report not ok' },
    })
    return { ok: false }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'ncmec report threw'
    await admin.from('csam_incidents').update({ ncmec_status: 'failed' }).eq('id', incident.incidentId)
    void recordAudit({
      eventType: 'csam_ncmec_failed',
      actorRole: 'system',
      subjectType: 'content',
      subjectId: incident.contentId,
      metadata: { incident_id: incident.incidentId, error: reason },
    })
    return { ok: false }
  }
}
