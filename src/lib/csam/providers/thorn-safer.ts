import 'server-only'
import { isCsamEnabled } from '../config'
import type {
  CsamProvider,
  CsamScanInput,
  CsamScanResult,
} from '../provider'

// ─────────────────────────────────────────────────────────────────────────────
// ThornSaferProvider — ESQUELETO del vendor real de CSAM (Thorn Safer u otro).
// ─────────────────────────────────────────────────────────────────────────────
//
// Este es el slot del proveedor ESTABLECIDO de hash-matching + clasificadores.
// NO se implementa el matching real acá: el vendor real = credenciales + este
// adapter (mismo patrón que el KYC de Didit). Se selecciona con
// `CSAM_VENDOR=thorn-safer` y se activa por `isCsamEnabled()` (CSAM_API_KEY).
//
// FAIL-CLOSED: sin credenciales `scan()` tira 'CSAM provider not configured';
// con credenciales tira 'not implemented' (TODO del adapter real). En ambos
// casos el pipeline (src/lib/csam/scan.ts) trata la excepción como fail-closed:
// deja csam_status='pending' y el cron reintenta. NUNCA devuelve 'pass'.
// ─────────────────────────────────────────────────────────────────────────────

export class ThornSaferProvider implements CsamProvider {
  readonly name = 'thorn-safer'

  async scan(_input: CsamScanInput): Promise<CsamScanResult> {
    void _input
    if (!isCsamEnabled()) {
      // Fail-closed: sin credenciales no hay escaneo; el pipeline reintenta.
      throw new Error('CSAM provider not configured')
    }

    // TODO(vendor): implementar el hash-matching real contra el vendor.
    //   1. Obtener los bytes del media (download del bucket privado creator-content).
    //   2. Calcular el/los hash perceptuales (PhotoDNA/PDQ/MD5) o subir para scan.
    //   3. Llamar a la API del vendor (Bearer csamApiKey()); mapear su respuesta a
    //      CsamScanResult: match de hash conocido → {verdict:'blocked',
    //      matchType:'known_hash'}; clasificador de posible menor →
    //      {verdict:'blocked', matchType:'classifier_possible_minor'}; ambiguo →
    //      {verdict:'review'}; limpio → {verdict:'pass'}.
    //   4. (Async webhook opcional): verificar HMAC con csamWebhookSecret().
    throw new Error(
      '[csam/thorn-safer] real hash-matching not implemented — wire the vendor adapter (fail-closed)',
    )
  }
}
