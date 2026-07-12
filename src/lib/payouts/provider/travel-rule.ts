import 'server-only'
import { isProduction, isTravelRuleConfigured } from '../config'

// ─────────────────────────────────────────────────────────────────────────────
// Travel Rule (FATF R.16) — PR-8. Antes de que salga una transferencia por encima
// del umbral, el VASP originador debe transmitir los datos de originador +
// beneficiario al VASP receptor (esquema IVMS101 / protocolos TRP/TRISA/…).
//
// INTERFAZ + adapter real (esqueleto, fail-closed) + stub verificable. En Foguito
// el ORIGINADOR es la plataforma (paga desde su tesorería) y el BENEFICIARIO es la
// creadora. Ningún PII crudo se transmite acá: se ARMA la referencia y se delega
// el submit al proveedor (el VASP es el custodio de la data sensible).
// ─────────────────────────────────────────────────────────────────────────────

/** El originador del payout SIEMPRE es la plataforma (paga a la creadora). */
const PLATFORM_ORIGINATOR_NAME = 'Foguito'

export interface TravelRulePayout {
  /** `payouts.id` — la referencia opaca del payout. */
  id: string
  creatorId: string
  /** Monto en USDT (server-authoritative, de `payouts.amount_usdt`). */
  amountUsdt: number
}

export interface TravelRuleCreator {
  userId: string
  legalName?: string | null
  country?: string | null
  walletAddress?: string | null
}

export interface TravelRuleInfo {
  payoutRef: string
  asset: string
  amountUsdt: number
  originator: { name: string; type: 'platform' }
  beneficiary: {
    creatorId: string
    legalName: string | null
    country: string | null
    walletAddress: string | null
  }
}

export interface TravelRuleSubmitResult {
  /** Referencia del envío Travel Rule (se persiste en `payouts.travel_rule_ref`). */
  ref: string
}

/**
 * Arma la info de Travel Rule para un payout. Originador = plataforma, beneficiario
 * = creadora. Determinístico y puro (sin red) — el submit real lo hace el provider.
 */
export function assembleTravelRuleInfo(
  payout: TravelRulePayout,
  creator: TravelRuleCreator,
): TravelRuleInfo {
  return {
    payoutRef: payout.id,
    asset: 'USDT',
    amountUsdt: payout.amountUsdt,
    originator: { name: PLATFORM_ORIGINATOR_NAME, type: 'platform' },
    beneficiary: {
      creatorId: creator.userId,
      legalName: creator.legalName ?? null,
      country: creator.country ?? null,
      walletAddress: creator.walletAddress ?? null,
    },
  }
}

export interface TravelRuleProvider {
  readonly name: string
  /** Transmite la info de Travel Rule al VASP receptor. Devuelve la referencia. */
  submit(info: TravelRuleInfo): Promise<TravelRuleSubmitResult>
}

/**
 * Proveedor de Travel Rule real — ESQUELETO gated por `TRAVEL_RULE_API_KEY`. Hasta
 * que se cablee el submit real, `submit()` tira (fail-closed): sin proveedor no se
 * puede acreditar el cumplimiento del Travel Rule y por ende NO se puede marcar
 * 'sent' un payout.
 */
export class VaspTravelRuleProvider implements TravelRuleProvider {
  readonly name = 'vasp'

  async submit(_info: TravelRuleInfo): Promise<TravelRuleSubmitResult> {
    void _info
    // TODO(founder): submit real del Travel Rule (IVMS101 vía TRP/TRISA/vendor).
    //   1. Autenticar con travelRuleApiKey() (src/lib/payouts/config.ts).
    //   2. Construir el payload IVMS101 (originador plataforma, beneficiario creadora).
    //   3. Transmitir al VASP receptor; mapear la respuesta → { ref }.
    throw new Error('[payouts] VaspTravelRuleProvider submit not implemented (fail-closed)')
  }
}

/**
 * Proveedor STUB — SOLO scaffolding. NO llama a la red. Devuelve un ref fake
 * DETERMINÍSTICO (`STUB-TR-<payoutRef>`) para testear el flujo en dev/CI.
 *
 * FAIL-CLOSED en producción: en prod `submit()` TIRA → el caller no puede marcar
 * 'sent' (fail-closed). Un Travel Rule real EXIGE un proveedor configurado.
 */
export class StubTravelRuleProvider implements TravelRuleProvider {
  readonly name = 'stub'

  async submit(info: TravelRuleInfo): Promise<TravelRuleSubmitResult> {
    if (isProduction()) {
      throw new Error(
        '[payouts] StubTravelRuleProvider must not run in production — configure a real Travel Rule provider (fail-closed)',
      )
    }
    console.warn('[payouts] STUB Travel Rule provider — NO real submission; returning a fake ref', {
      payoutRef: info.payoutRef,
    })
    return { ref: `STUB-TR-${info.payoutRef}` }
  }
}

/**
 * Factory del proveedor de Travel Rule. Real si hay credenciales
 * (`isTravelRuleConfigured()`), si no el stub (que tira en prod).
 */
export function getTravelRuleProvider(): TravelRuleProvider {
  return isTravelRuleConfigured() ? new VaspTravelRuleProvider() : new StubTravelRuleProvider()
}

/**
 * Conveniencia: arma-y-envía no está acá (el armado es un paso aparte, testeable).
 * Este helper delega el submit al proveedor seleccionado por la factory.
 */
export async function submitTravelRule(info: TravelRuleInfo): Promise<TravelRuleSubmitResult> {
  return getTravelRuleProvider().submit(info)
}
