import 'server-only'
import { isProduction } from './config'

// ─────────────────────────────────────────────────────────────────────────────
// Reporter NCMEC (CyberTipline) — el reporte de CSAM es OBLIGATORIO por ley.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ante un hit confirmado, la plataforma DEBE reportar a NCMEC. El pipeline
// (src/lib/csam/scan.ts) persiste el incidente ANTES de reportar y guarda el
// estado del reporte de forma durable (`csam_incidents.ncmec_status`), así que
// un fallo transitorio del reporte no se pierde: el cron /api/cron/csam-report-
// retry lo reintenta hasta 'reported'.
//
// Como el resto del pilar #0, esto es INTERFAZ + STUB verificable: el envío real
// al CyberTipline (esquema XML/REST del vendor) es un TODO gated por
// `NCMEC_REPORT_API_KEY`. El stub NO llama a la red — loguea la intención y
// devuelve un reportId fake determinístico para dejar el pipeline testeable.
//
// NUNCA se pasan bytes ni PII acá: solo referencias (ids, paths, veredicto).
// NUNCA importar desde un Client Component — `server-only` lo enforcea en build.
// ─────────────────────────────────────────────────────────────────────────────

export interface NcmecIncident {
  /** Id de la fila `csam_incidents` (clave del reporte, para idempotencia). */
  incidentId: string
  contentId: string | null
  creatorId: string | null
  verdict: string
  matchType?: string | null
  provider: string
  /** Path en el bucket `csam-evidence` donde se preservó el material. */
  evidencePath?: string | null
}

export interface NcmecReportResult {
  ok: boolean
  reportId?: string
  error?: string
}

export interface NcmecReporter {
  /** Reporta un incidente al CyberTipline. Idempotente por incidentId. */
  report(incident: NcmecIncident): Promise<NcmecReportResult>
}

/** ¿Están las credenciales de NCMEC configuradas? (activa el reporter real) */
export function isNcmecConfigured(): boolean {
  return Boolean(process.env.NCMEC_REPORT_API_KEY)
}

/**
 * Reporter STUB — SOLO scaffolding. NO llama a la red. Loguea la intención y
 * devuelve un reportId fake DETERMINÍSTICO (`STUB-NCMEC-<incidentId>`) para que
 * el pipeline (preservar → bloquear → reportar) sea testeable de punta a punta.
 */
export class NcmecReporterStub implements NcmecReporter {
  readonly name = 'stub'

  async report(incident: NcmecIncident): Promise<NcmecReportResult> {
    // Solo refs — nunca bytes ni PII.
    console.warn('[csam/ncmec] STUB reporter — NO real CyberTipline submission', {
      incidentId: incident.incidentId,
      contentId: incident.contentId,
      verdict: incident.verdict,
      matchType: incident.matchType ?? null,
      provider: incident.provider,
    })
    // FAIL-CLOSED en producción: el stub NUNCA puede dar por enviado un reporte
    // obligatorio. En prod devuelve ok:false → el incidente queda 'failed' y el
    // cron de retry lo mantiene vivo hasta que se cablee el reporter real. El
    // reportId fake determinístico solo sirve en dev/CI para testear el pipeline.
    if (isProduction()) {
      return { ok: false, error: 'stub NCMEC reporter must not certify a report in production' }
    }
    return { ok: true, reportId: `STUB-NCMEC-${incident.incidentId}` }
  }
}

/**
 * Reporter real — ESQUELETO gated por `NCMEC_REPORT_API_KEY`. Hasta que se
 * implemente el envío real, `report()` tira: el pipeline lo captura, deja el
 * incidente en 'failed' y el cron de retry lo reintenta (fail-closed: el reporte
 * obligatorio NUNCA se pierde).
 */
export class NcmecReporterHttp implements NcmecReporter {
  readonly name = 'ncmec-http'

  async report(_incident: NcmecIncident): Promise<NcmecReportResult> {
    void _incident
    // TODO(vendor): envío real al CyberTipline de NCMEC.
    //   1. Autenticar con ncmecApiKey()/ncmecOrgId() (src/lib/csam/config.ts).
    //   2. Construir el reporte (schema NCMEC), adjuntar la evidencia preservada
    //      (bucket csam-evidence) por referencia/upload seguro.
    //   3. POST al CyberTipline; mapear la respuesta a { ok, reportId }.
    throw new Error('[csam/ncmec] real CyberTipline reporter not implemented (fail-closed)')
  }
}

/**
 * Factory del reporter. Devuelve el reporter real si hay credenciales, si no el
 * stub determinístico (dev/CI). El pipeline es agnóstico del reporter concreto.
 */
export function getNcmecReporter(): NcmecReporter {
  return isNcmecConfigured() ? new NcmecReporterHttp() : new NcmecReporterStub()
}
