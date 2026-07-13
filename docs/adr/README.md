# Architecture Decision Records (ADR)

Decisiones arquitectónicas significativas de Foguito. Cada ADR es inmutable una vez aceptado;
si una decisión se revierte, se agrega un ADR nuevo que la supersede (no se edita el viejo).

Formato: **Status · Context · Decision · Consequences**.

| # | Decisión | Status |
|---|----------|--------|
| [0001](0001-fail-closed-vendor-stubs.md) | Provider fail-closed + stub verificable para todo vendor externo | Accepted |
| [0002](0002-aml-three-surface-screening.md) | AML: una puerta (`screenSubject`) para las tres superficies + anti-downgrade | Accepted |
| [0003](0003-takedown-via-content-status.md) | Takedown se propaga vía `content.status='removed'` (sin tabla `takedowns`) | Accepted |
| [0004](0004-deployment-topology.md) | Deploy: apex canónico + Cloudflare DNS-only + Vercel Pro | Accepted |
| [0005](0005-money-in-mor-nonredeemable.md) | Money-in merchant-of-record, PAN cero, foguitos no redimibles | Accepted |
