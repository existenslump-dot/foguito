# 0001 — Provider fail-closed + stub verificable para todo vendor externo

**Status:** Accepted (2026-07)

## Context

Foguito depende de vendors de compliance/pagos que no están contratados durante el desarrollo
(Didit, CSAM/NCMEC, age-verify, NOWPayments, on-ramp, VASP, Travel-Rule, sanciones). Necesitábamos
construir y testear el flujo completo end-to-end sin credenciales reales, sin que la ausencia de un
vendor abra un agujero de seguridad (p. ej. dejar pasar contenido sin screening, o pagar sin KYC).

## Decision

Cada integración externa sigue el patrón **interfaz + stub verificable + `isProduction()` fail-closed**:

- Una `Provider` interface con un factory `getXProvider()` que devuelve el **vendor real** si hay
  credenciales (`isXConfigured()`), o un **stub** si no.
- El stub es **determinístico en dev/CI** (sentinels en el id para testear cada rama) pero
  **fail-closed en producción**: nunca otorga un veredicto permisivo (`clear`/`pass`/`verified`). En
  prod sin vendor, devuelve el estado no-elegible (`review`/`hit`/throw) — nunca desbloquea.
- El vendor real **tira** hasta estar cableado (no hay implementación silenciosa que devuelva ok).

## Consequences

- El sitio deploya y corre inerte: features de vendor apagadas, sin cobros ni publicación real, sin
  agujeros. Cablear un vendor = cargar su API key (+ flag si aplica); el provider real reemplaza al
  stub sin cambios de código.
- Los tests cubren el flujo completo con el stub determinístico.
- Riesgo cubierto: un deploy accidental a prod sin credenciales **no** puede clarear a nadie.
- Costo: hay que recordar que "en prod el stub no clarea" al testear manualmente en prod-sin-vendor
  (p. ej. sanciones siempre da `review`, no `clear`).
