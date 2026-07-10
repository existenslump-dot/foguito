/**
 * STUB — shipped with the BASE kit. The canonical signature-verification
 * implementations (the valuable HMAC logic) live in the **Payments add-on**.
 * Same public surface so the base compiles; every call throws at runtime.
 */

const NOT_INSTALLED =
  '[payments-kit] Payments add-on not installed. Signature verification lives in ' +
  'the Payments add-on — buy it to enable real webhook verification.'

export interface SignatureVerdict {
  ok: boolean
  reason?: string
}

export function verifyMercadoPagoSignature(_params: {
  xSignature: string | null
  xRequestId: string | null
  dataId: string | number
  secret: string
}): SignatureVerdict {
  throw new Error(NOT_INSTALLED)
}

export function verifyNowPaymentsSignature(_params: {
  rawBody: string
  signature: string | null
  secret: string
}): SignatureVerdict {
  throw new Error(NOT_INSTALLED)
}
