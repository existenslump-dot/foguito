import 'server-only'
import type { FoguitoPack } from '../packs'
import { isProduction, isNowpaymentsConfigured } from '../config'

// ─────────────────────────────────────────────────────────────────────────────
// Provider de money-in (dinero → foguitos). INTERFAZ + adapter real (esqueleto,
// fail-closed) + stub verificable. Mismo molde que src/lib/csam/index.ts:
// getCsamProvider + stub-que-tira-en-prod.
// ─────────────────────────────────────────────────────────────────────────────
//
// La app habla SIEMPRE contra `FoguitoPaymentProvider`, nunca contra un
// procesador concreto → enchufar NOWPayments (u otro MoR) es cablear el adapter,
// no reescribir el checkout. El PAN NUNCA toca la app: el provider hostea el
// pago y sólo devuelve una dirección/URL a la que mandar al fan.
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado del alta de checkout: id del pago en el gateway + target hosteado. */
export interface FoguitoCheckout {
  /** Id del pago del lado del gateway (se persiste en `foguito_orders`). */
  gatewayTxId: string
  /** Dirección de pago on-chain (crypto) o `null` si el provider usa URL. */
  payAddress: string | null
  /** URL de checkout hosteado (redirect) o `null` si el provider usa dirección. */
  payUrl: string | null
}

export interface FoguitoPaymentProvider {
  /** Identificador estable, ej: 'nowpayments' | 'stub'. */
  readonly name: string
  /**
   * Da de alta un cobro por el precio del pack. El monto/moneda salen del pack
   * (catálogo server-authoritative), NUNCA del cliente. `orderRef` es nuestro id
   * opaco: el provider lo ecoa en el IPN para correlacionar.
   */
  createCheckout(orderRef: string, pack: FoguitoPack): Promise<FoguitoCheckout>
}

/**
 * Adapter NOWPayments — ESQUELETO gated por `NOWPAYMENTS_API_KEY`. Hasta que se
 * cablee el POST real a la API, `createCheckout()` tira: el checkout lo captura,
 * marca la orden 'failed' y responde 502 (fail-closed — jamás se entrega un
 * target de pago que no se pudo crear). Mismo patrón que el reporter NCMEC.
 */
export class NowpaymentsFoguitoProvider implements FoguitoPaymentProvider {
  readonly name = 'nowpayments'

  async createCheckout(_orderRef: string, _pack: FoguitoPack): Promise<FoguitoCheckout> {
    void _orderRef
    void _pack
    // TODO(founder): alta real del pago en NOWPayments.
    //   1. Autenticar con nowpaymentsApiKey() (src/lib/foguitos/config.ts).
    //   2. POST a `${NOWPAYMENTS_API}/v1/payment` con:
    //        price_amount    = pack.priceAmount
    //        price_currency  = pack.priceCurrency  (p.ej. 'usd')
    //        order_id        = orderRef            (se ecoa en el IPN)
    //        ipn_callback_url = `${NEXT_PUBLIC_APP_URL}/api/webhooks/foguitos/nowpayments`
    //        pay_currency    = <cripto elegida>    (p.ej. 'usdttrc20')
    //   3. Mapear la respuesta → { gatewayTxId: payment_id, payAddress: pay_address, payUrl: null }.
    throw new Error('[foguitos] NOWPayments createCheckout not implemented (fail-closed)')
  }
}

/**
 * Provider STUB — SOLO scaffolding. NO llama a la red. Devuelve una dirección de
 * pago fake DETERMINÍSTICA (`STUB-<orderRef>`) para que el checkout sea testeable
 * de punta a punta en dev/CI SIN mover un centavo.
 *
 * FAIL-CLOSED en producción: el stub NUNCA cobra/acredita en prod. En prod
 * `createCheckout()` tira → el checkout marca la orden 'failed' y responde 502.
 * Un cobro real EXIGE un procesador configurado (`isNowpaymentsConfigured()`).
 */
export class StubFoguitoProvider implements FoguitoPaymentProvider {
  readonly name = 'stub'

  async createCheckout(orderRef: string, _pack: FoguitoPack): Promise<FoguitoCheckout> {
    void _pack
    if (isProduction()) {
      throw new Error(
        '[foguitos] StubFoguitoProvider must not run in production — configure a real processor (fail-closed)',
      )
    }
    console.warn('[foguitos] STUB payment provider — NO real charge; returning a fake pay address', {
      orderRef,
    })
    return { gatewayTxId: `STUB-${orderRef}`, payAddress: 'STUB', payUrl: null }
  }
}

/**
 * Factory del provider de money-in. Devuelve el adapter real si hay credenciales
 * (`isNowpaymentsConfigured()`), si no el stub determinístico (dev/CI).
 *
 * En PROD sin credenciales devuelve el stub, cuyo `createCheckout()` tira →
 * fail-closed: NUNCA un cobro stub en prod. En PROD con credenciales devuelve el
 * adapter real, cuyo `createCheckout()` es un esqueleto que también tira hasta
 * que se cablee el POST real → tampoco se cobra hasta entonces.
 */
export function getFoguitoPaymentProvider(): FoguitoPaymentProvider {
  return isNowpaymentsConfigured() ? new NowpaymentsFoguitoProvider() : new StubFoguitoProvider()
}
