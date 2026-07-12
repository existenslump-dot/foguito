import 'server-only'
import { isProduction, isPayoutConfigured, isSanctionsConfigured } from '../config'

// ─────────────────────────────────────────────────────────────────────────────
// Providers de MONEY-OUT (PR-8): transferencia al VASP/PSP + screening de
// sanciones. INTERFAZ + adapter real (esqueleto, fail-closed) + stub verificable.
// Mismo molde que src/lib/foguitos/provider/index.ts (money-in) y el reporter
// NCMEC de src/lib/csam/ncmec.ts (stub-que-tira/‑review en prod).
// ─────────────────────────────────────────────────────────────────────────────
//
// La app habla SIEMPRE contra las interfaces, nunca contra un VASP concreto →
// enchufar un VASP/PSP (Fireblocks, Bitso Business, un banco, …) es cablear el
// adapter, no reescribir el flujo de payout. Ningún dato bancario/wallet crudo se
// procesa acá: el VASP es el custodio; la app sólo le pasa referencias.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Beneficiario del payout = la creadora. Datos mínimos por referencia; el VASP
 * resuelve la wallet/cuenta real desde el onboarding (KYC de payout). La app NO
 * es custodia de secretos de pago.
 */
export interface PayoutBeneficiary {
  creatorId: string
  /** Nombre legal (para Travel Rule / KYC del VASP). Puede faltar en el stub. */
  legalName?: string | null
  country?: string | null
  /** Wallet/cuenta destino (opaca a la app; la resuelve el VASP en onboarding). */
  walletAddress?: string | null
}

export interface SendPayoutArgs {
  creatorId: string
  /** Monto en USDT — server-authoritative, sale de `payouts.amount_usdt` (la DB). */
  amountUsdt: number
  beneficiary: PayoutBeneficiary
}

export interface PayoutSendResult {
  /** Id de la transferencia del lado del VASP (se persiste en `payouts.vasp_tx_id`). */
  vaspTxId: string
}

export interface PayoutProvider {
  /** Identificador estable, ej: 'vasp' | 'stub'. */
  readonly name: string
  /**
   * Ordena la transferencia del payout al beneficiario. `payoutRef` es nuestro id
   * opaco (`payouts.id`); el VASP lo ecoa en el webhook de settlement. El monto
   * sale de la DB, NUNCA del cliente. Fail-closed: si no puede transferir, TIRA
   * (el caller lo captura, marca el payout 'failed'/'held' y NO lo marca 'sent').
   */
  sendPayout(payoutRef: string, args: SendPayoutArgs): Promise<PayoutSendResult>
}

/**
 * Adapter VASP real — ESQUELETO gated por `PAYOUT_API_KEY`. Hasta que se cablee la
 * transferencia real, `sendPayout()` tira: el caller lo captura, marca el payout
 * 'failed' y responde 502 (fail-closed — JAMÁS se marca 'sent' un payout que no se
 * pudo transferir). Mismo patrón que NowpaymentsFoguitoProvider / NcmecReporterHttp.
 */
export class VaspPayoutProvider implements PayoutProvider {
  readonly name = 'vasp'

  async sendPayout(_payoutRef: string, _args: SendPayoutArgs): Promise<PayoutSendResult> {
    void _payoutRef
    void _args
    // TODO(founder): transferencia real vía el VASP/PSP.
    //   1. Autenticar con payoutApiKey() (src/lib/payouts/config.ts).
    //   2. Resolver la wallet/cuenta del beneficiario desde el onboarding de payout.
    //   3. POST de la orden de transferencia (monto = args.amountUsdt en USDT),
    //      idempotente por payoutRef.
    //   4. Mapear la respuesta → { vaspTxId } (id de tx del VASP).
    //   5. El settlement final llega asíncrono al webhook /api/webhooks/payouts.
    throw new Error('[payouts] VaspPayoutProvider sendPayout not implemented (fail-closed)')
  }
}

/**
 * Provider STUB — SOLO scaffolding. NO llama a la red. Devuelve un vaspTxId fake
 * DETERMINÍSTICO (`STUB-VASP-<payoutRef>`) para que el flujo de payout sea testeable
 * de punta a punta en dev/CI SIN mover un centavo.
 *
 * FAIL-CLOSED en producción: el stub NUNCA transfiere en prod. En prod `sendPayout()`
 * TIRA → el caller marca el payout 'failed' y responde 502. Una transferencia real
 * EXIGE un VASP configurado (`isPayoutConfigured()`).
 */
export class StubPayoutProvider implements PayoutProvider {
  readonly name = 'stub'

  async sendPayout(payoutRef: string, args: SendPayoutArgs): Promise<PayoutSendResult> {
    if (isProduction()) {
      throw new Error(
        '[payouts] StubPayoutProvider must not transfer in production — configure a real VASP/PSP (fail-closed)',
      )
    }
    console.warn('[payouts] STUB payout provider — NO real transfer; returning a fake vaspTxId', {
      payoutRef,
      creatorId: args.creatorId,
      amountUsdt: args.amountUsdt,
    })
    return { vaspTxId: `STUB-VASP-${payoutRef}` }
  }
}

/**
 * Factory del provider de transferencia. Real si hay credenciales
 * (`isPayoutConfigured()`), si no el stub determinístico (dev/CI).
 *
 * En PROD sin credenciales devuelve el stub, cuyo `sendPayout()` tira →
 * fail-closed: NUNCA una transferencia stub en prod. En PROD con credenciales
 * devuelve el adapter real, cuyo `sendPayout()` es un esqueleto que también tira
 * hasta que se cablee la transferencia real → tampoco se transfiere hasta entonces.
 */
export function getPayoutProvider(): PayoutProvider {
  return isPayoutConfigured() ? new VaspPayoutProvider() : new StubPayoutProvider()
}

// ─────────────────────────────────────────────────────────────────────────────
// Screening de sanciones (OFAC/UN/EU/…). Gate de elegibilidad del payout: sin
// `sanctions_status='clear'` la creadora NO cobra (RPC + payouts_guard lo enforcean
// en la DB; el path de `send` re-screenea como defensa en profundidad).
// ─────────────────────────────────────────────────────────────────────────────

/** Veredicto del screening. Mapea 1:1 a `creators.sanctions_status`. */
export type SanctionsStatus = 'clear' | 'review' | 'hit'

export interface SanctionsScreenArgs {
  creatorId: string
  legalName?: string | null
  country?: string | null
}

export interface SanctionsScreenResult {
  status: SanctionsStatus
  /** Referencia del screening del vendor (se persiste en `payouts.sanctions_ref`). */
  ref: string
}

export interface SanctionsProvider {
  readonly name: string
  /** Screenea a la creadora contra listas de sanciones. Idempotente por creatorId. */
  screen(args: SanctionsScreenArgs): Promise<SanctionsScreenResult>
}

/**
 * Vendor de sanciones real — ESQUELETO gated por `SANCTIONS_API_KEY`. Hasta que se
 * cablee el screening real, `screen()` tira (fail-closed): sin vendor real NO se
 * puede declarar 'clear' a nadie.
 */
export class VendorSanctionsProvider implements SanctionsProvider {
  readonly name = 'vendor'

  async screen(_args: SanctionsScreenArgs): Promise<SanctionsScreenResult> {
    void _args
    // TODO(founder): screening real contra listas de sanciones (OFAC/UN/EU/…).
    //   1. Autenticar con sanctionsApiKey() (src/lib/payouts/config.ts).
    //   2. Enviar los datos del beneficiario al vendor (nombre legal, país, …).
    //   3. Mapear la respuesta → { status: 'clear'|'review'|'hit', ref }.
    throw new Error('[payouts] VendorSanctionsProvider screen not implemented (fail-closed)')
  }
}

/**
 * Screening STUB — SOLO scaffolding. NO llama a la red.
 *
 * FAIL-CLOSED en producción: en prod devuelve SIEMPRE `{ status: 'review' }` — NUNCA
 * auto-clarea. Otorgar elegibilidad ('clear') en prod EXIGE un vendor real; el stub
 * jamás puede habilitar un payout en prod. (Espeja NcmecReporterStub, que en prod
 * jamás certifica un reporte.)
 *
 * En dev/CI es DETERMINÍSTICO por creatorId (para testear el flujo completo):
 * default 'clear', salvo un sentinel en el id (`sanctions-hit` → 'hit',
 * `sanctions-review` → 'review') — mismo patrón que el stub de CSAM.
 */
export class StubSanctionsProvider implements SanctionsProvider {
  readonly name = 'stub'

  async screen(args: SanctionsScreenArgs): Promise<SanctionsScreenResult> {
    const ref = `STUB-SANCTIONS-${args.creatorId}`
    if (isProduction()) {
      // Fail-closed: en prod el stub jamás clarea. Queda en 'review' → no elegible.
      console.warn('[payouts] STUB sanctions provider in production — forcing review (no auto-clear)', {
        creatorId: args.creatorId,
      })
      return { status: 'review', ref }
    }
    const id = args.creatorId.toLowerCase()
    const status: SanctionsStatus = id.includes('sanctions-hit')
      ? 'hit'
      : id.includes('sanctions-review')
        ? 'review'
        : 'clear'
    return { status, ref }
  }
}

/**
 * Factory del provider de sanciones. Real si hay credenciales
 * (`isSanctionsConfigured()`), si no el stub. En PROD sin credenciales devuelve el
 * stub, cuyo `screen()` fuerza 'review' → nadie queda elegible por el stub en prod.
 */
export function getSanctionsProvider(): SanctionsProvider {
  return isSanctionsConfigured() ? new VendorSanctionsProvider() : new StubSanctionsProvider()
}
