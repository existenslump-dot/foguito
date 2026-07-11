// ─────────────────────────────────────────────────────────────────────────────
// CSAM detection provider interface (PILAR #0 — bloqueante, pre-publicación)
// ─────────────────────────────────────────────────────────────────────────────
//
// Detección de CSAM es una capacidad de VENDOR ESTABLECIDO (Thorn Safer /
// PhotoDNA / IWF hash-matching + clasificadores) — NUNCA se construye desde cero.
// El engine habla contra esta interfaz `CsamProvider` y nunca contra un vendor
// concreto, así que enchufar el proveedor real (adapter + credenciales) es un
// cambio de config, no una reescritura. Mismo patrón que src/lib/kyc/provider.ts.
//
// Built-in provider: `stub` (src/lib/csam/providers/stub.ts) — DETERMINÍSTICO,
// SIN RED, SOLO scaffolding para testear el pipeline. El vendor real se
// implementa en providers/thorn-safer.ts detrás de `isCsamEnabled()`.
//
// INVARIANTE (pilar #0): nada publica sin csam_status='pass'. Un error/veredicto
// desconocido es FAIL-CLOSED (queda 'pending', el cron reintenta). Un
// `classifier_possible_minor` es un HIT DURO (bloqueo + preservación + reporte),
// nunca un 'review'.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Veredicto normalizado del escaneo, agnóstico del vendor:
 *   - `pass`    → sin match; la pieza avanza a revisión humana (in_review).
 *   - `blocked` → HIT confirmado (hash conocido / clasificador). Bloqueo duro.
 *   - `review`  → ambiguo (NO menor): requiere revisión humana, NUNCA auto-pass.
 */
export type CsamVerdict = 'pass' | 'blocked' | 'review'

/**
 * Naturaleza del match (cuando lo hay):
 *   - `known_hash`               → coincidencia con un hash conocido (NCMEC/IWF).
 *   - `classifier_possible_minor`→ clasificador marca posible menor. HIT DURO.
 */
export type CsamMatchType = 'known_hash' | 'classifier_possible_minor'

export interface CsamScanResult {
  verdict: CsamVerdict
  /** Presente cuando verdict='blocked' (o el clasificador marca posible menor). */
  matchType?: CsamMatchType
  /** Confianza del proveedor [0..1], opcional. */
  score?: number
  /** Identificador estable del proveedor que emitió el veredicto. */
  provider: string
  /** Payload crudo del vendor, para auditoría/debug. NUNCA se propaga al fan. */
  raw?: unknown
}

export interface CsamScanInput {
  contentId: string
  /** Path privado del media en el bucket `creator-content` (no una URL). */
  mediaRef: string
  /** 'image' | 'video' | 'audio'. */
  mediaType: string
  /** Bytes opcionales (algunos providers hashean el binario en vez del path). */
  bytes?: Uint8Array
}

export interface CsamProvider {
  /** Identificador estable, ej: 'stub' | 'thorn-safer'. */
  name: string

  /**
   * Escanea una pieza de contenido. Resuelve con el veredicto normalizado.
   * DEBE ser fail-closed en el borde: si no puede decidir, tirar (el pipeline
   * lo trata como pending y reintenta) — NUNCA devolver 'pass' por defecto.
   */
  scan(input: CsamScanInput): Promise<CsamScanResult>
}
