# 0003 — Takedown se propaga vía `content.status='removed'` (sin tabla `takedowns`)

**Status:** Accepted (2026-07, PR-9)

## Context

La cola de quejas (`moderation_events`) necesita ejecutar takedowns que corten la entrega del
contenido en TODAS las superficies (feed, teaser, detalle, entrega firmada) inmediatamente. Una
opción era una tabla `takedowns` aparte que las superficies consultaran; otra, reusar el gate de
visibilidad que ya existe.

## Decision

- El takedown **sólo setea `content.status='removed'`** (service-role). No se crea tabla `takedowns`.
- La propagación la hacen la **RLS `content_select`** + los guards de PR-5, que ya gatean
  `status='published' AND csam_status='pass'` **antes** del check de entitlement → un `removed`
  desaparece de todas las superficies al instante, sin revocar entitlements ni invalidar cache.
- El estado del takedown vive en `content.status` + `audit_log` (`takedown_executed`) +
  `moderation_events.resolution` — redundar en una tabla aparte sería inconsistencia potencial.
- **Nunca** se purga 2257/CSAM/media en un takedown (retención legal independiente). El export a
  autoridad es **sólo referencial** (paths, nunca bytes ni PII descifrada).

## Consequences

- Una sola fuente de verdad de visibilidad (el gate de RLS ya probado en PR-5).
- Takedown idempotente y barato; sin coordinación entre tablas.
- El intake de quejas no tiene oráculo (misma respuesta genérica exista o no el contenido) y ninguna
  ruta auto-baja contenido: el takedown es siempre admin-in-the-loop con TOTP fresca+enrolada.
