import type {
  CsamProvider,
  CsamScanInput,
  CsamScanResult,
} from '../provider'

// ─────────────────────────────────────────────────────────────────────────────
// StubCsamProvider — SOLO SCAFFOLDING. NO es un detector real de CSAM.
// ─────────────────────────────────────────────────────────────────────────────
//
// DETERMINÍSTICO y SIN RED: hace testeable todo el pipeline (claim → scan →
// aplicar veredicto → hit → preservar → bloquear → reportar) sin depender de un
// vendor. NO hace hash-matching ni clasificación real: reconoce SENTINELS
// conocidos (en el mediaRef o en los bytes) y emite el veredicto asociado. Todo
// lo demás → 'pass'.
//
// ⚠️ En producción esto NO protege nada por sí solo: da 'pass' a todo el
// contenido genuino. La detección real vive en providers/thorn-safer.ts (o el
// vendor que sea) y se activa con credenciales (`isCsamEnabled()`). Este stub
// existe para (a) ejercitar el pipeline en dev/CI y (b) permitir que el resto
// del sistema embarque inerte pero funcional.
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinels de test. Un mediaRef/bytes que los contenga fuerza el veredicto. */
export const CSAM_STUB_SENTINELS = {
  /** Fuerza un hit por hash conocido → blocked / known_hash. */
  knownHash: 'csam-test-hit',
  /** Fuerza un hit del clasificador → blocked / classifier_possible_minor (HIT DURO). */
  possibleMinor: 'csam-test-minor',
  /** Fuerza un caso ambiguo → review (NUNCA auto-pass). */
  review: 'csam-test-review',
} as const

/** Concatena mediaRef + (bytes decodificados como texto) para buscar sentinels. */
function buildHaystack(input: CsamScanInput): string {
  let haystack = input.mediaRef ?? ''
  if (input.bytes && input.bytes.length > 0) {
    try {
      haystack += '\n' + new TextDecoder('utf-8', { fatal: false }).decode(input.bytes)
    } catch {
      // Binario no-texto: los sentinels son ASCII, así que ignorar es correcto.
    }
  }
  return haystack
}

export class StubCsamProvider implements CsamProvider {
  readonly name = 'stub'

  async scan(input: CsamScanInput): Promise<CsamScanResult> {
    const haystack = buildHaystack(input)

    // Orden: el clasificador de posible-menor se evalúa PRIMERO — es el hit más
    // severo y su matchType debe prevalecer (invariante: possible_minor = HIT
    // DURO). Luego hash conocido, luego el caso ambiguo, y por último pass.
    if (haystack.includes(CSAM_STUB_SENTINELS.possibleMinor)) {
      return {
        verdict: 'blocked',
        matchType: 'classifier_possible_minor',
        score: 0.99,
        provider: this.name,
        raw: { stub: true, sentinel: CSAM_STUB_SENTINELS.possibleMinor },
      }
    }
    if (haystack.includes(CSAM_STUB_SENTINELS.knownHash)) {
      return {
        verdict: 'blocked',
        matchType: 'known_hash',
        score: 1,
        provider: this.name,
        raw: { stub: true, sentinel: CSAM_STUB_SENTINELS.knownHash },
      }
    }
    if (haystack.includes(CSAM_STUB_SENTINELS.review)) {
      return {
        verdict: 'review',
        score: 0.5,
        provider: this.name,
        raw: { stub: true, sentinel: CSAM_STUB_SENTINELS.review },
      }
    }
    return { verdict: 'pass', provider: this.name, raw: { stub: true } }
  }
}
