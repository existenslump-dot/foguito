import type { Event } from '@sentry/nextjs'

/**
 * Scrubber de PII para eventos de Sentry (PR-10, hardening).
 *
 * Se corre en `beforeSend`/`beforeSendTransaction` de los TRES runtimes
 * (client/server/edge) — factorizado acá para que ninguno se olvide de una capa.
 * Quita antes de que el evento salga:
 *   - `request.cookies`  → sesión completa.
 *   - `request.headers`  → `authorization` / `cookie` / `x-nowpayments-sig`
 *      (case-insensitive: los headers pueden llegar con cualquier capitalización).
 *   - `user`             → se reduce a `{ id }` (fuera email / ip_address / username).
 *   - `server_name`      → hostname del server (fingerprint de infra).
 *
 * Defensivo: nunca tira (un throw acá tumbaría el pipeline de Sentry) — todo va
 * envuelto en try/catch + optional chaining. Es aditivo al tagging existente
 * (`tagFeatureBeforeSend`): se compone, no lo reemplaza.
 */

/** Headers cuyo valor jamás debe viajar a Sentry (comparación en minúsculas). */
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'x-nowpayments-sig'])

export function scrubEvent<T extends Event>(event: T): T {
  if (!event) return event
  try {
    const req = event.request as Record<string, unknown> | undefined
    if (req) {
      // Sesión/cookies crudas.
      if ('cookies' in req) delete req.cookies
      // Body y query-string crudos (pueden traer credenciales / PII de forms).
      if ('data' in req) delete req.data
      if ('query_string' in req) delete req.query_string
      // Headers sensibles (case-insensitive).
      const headers = req.headers as Record<string, unknown> | undefined
      if (headers && typeof headers === 'object') {
        for (const key of Object.keys(headers)) {
          if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
            delete headers[key]
          }
        }
      }
    }

    // Breadcrumbs: se descarta el `data` de cada uno (un console.error/fetch previo
    // podría cargar PII ahí). Se conserva message/category/level para debug.
    if (Array.isArray(event.breadcrumbs)) {
      for (const b of event.breadcrumbs) {
        if (b && typeof b === 'object' && 'data' in b) {
          delete (b as { data?: unknown }).data
        }
      }
    }

    // El usuario se reduce a su id (nada de PII directa).
    const user = event.user as Record<string, unknown> | undefined
    if (user && typeof user === 'object') {
      delete user.email
      delete user.ip_address
      delete user.username
    }

    // Hostname del server → fuera.
    event.server_name = undefined
  } catch {
    // Nunca tirar desde un hook de Sentry.
  }
  return event
}
