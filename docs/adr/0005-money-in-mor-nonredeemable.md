# 0005 — Money-in merchant-of-record, PAN cero, foguitos no redimibles

**Status:** Accepted (2026-07, PR-6/7/8)

## Context

Plataforma de contenido adulto con pago a creadoras. El riesgo regulatorio y de fraude de manejar
tarjetas y flujos de dinero directo entre fan y creadora es alto. Había que definir cómo entra el
dinero, qué toca la plataforma, y qué representa el crédito interno.

## Decision

- La **plataforma es merchant-of-record**; el fan **nunca** paga directo a la creadora.
- **PAN cero:** la app nunca recibe/almacena números de tarjeta. El cargo va por un procesador
  hosted / on-ramp licenciado (card→USDT) y figura como compra de cripto. Multi-procesador desde el
  diseño (no dependencia de uno solo).
- El crédito interno **"foguitos"** es de **bucle cerrado**: no redimible a efectivo/cripto, no
  transferible. Vive en `credit_ledger` **doble-entrada inmutable** (idempotencia + advisory locks).
- El **payout a la creadora es la única pata regulada** (PR-8): revenue-split, gated por payout-KYC +
  Travel-Rule + sanciones `clear` + registro fiscal, con máquina de estados y claim atómico
  (`sending`) para evitar doble-transferencia.

## Consequences

- El AML del consumidor es acotado: los foguitos no son extraíbles, así que el vector real de
  lavado está en el payout (screeneado) — el gate del consumidor corta el `hit` duro (OFAC) en el
  money-in (`held_aml`).
- El webhook de money-in **siempre** verifica firma HMAC (fail-closed), independiente del flag
  `FOGUITOS_PAYMENTS_ENABLED`; el monto sale de la orden (server-authoritative), nunca del webhook.
- Contratar acquirer high-risk + on-ramp licenciado + VASP es prerequisito de go-live de cobros.
