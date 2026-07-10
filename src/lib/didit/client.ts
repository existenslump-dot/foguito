import 'server-only'
import {
  DIDIT_VERIFICATION_BASE,
  diditApiKey,
  diditWorkflowId,
} from './config'
import type {
  DiditCreateSessionParams,
  DiditDecision,
  DiditResult,
  DiditSession,
} from './types'

/**
 * HTTP client for Didit's API (server-only).
 *
 * Only two server-side operations:
 *   - createSession: starts a verification, returns the hosted URL.
 *   - getDecision:   reconciliation / fallback if a webhook is lost.
 *
 * Auth: `x-api-key` header. Returns a discriminated Result (the repo's style)
 * instead of throwing, so the caller handles errors without try/catch.
 *
 * Docs: https://docs.didit.me/reference/api-full-flow
 */

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (body && typeof body === 'object') {
      const msg = (body as Record<string, unknown>).message ?? (body as Record<string, unknown>).error
      if (typeof msg === 'string') return msg
    }
  } catch {
    /* non-JSON body */
  }
  return `Didit responded with ${res.status}`
}

/**
 * Creates a verification session. `vendor_data` carries our user id so we can
 * recover it in the webhook.
 */
export async function createSession(
  params: DiditCreateSessionParams,
): Promise<DiditResult<DiditSession>> {
  const body: Record<string, unknown> = {
    workflow_id: diditWorkflowId(),
    vendor_data: params.vendorData,
    language: params.language ?? 'en',
  }
  if (params.callback) body.callback = params.callback
  if (params.metadata) body.metadata = params.metadata
  if (params.contactDetails) body.contact_details = params.contactDetails

  let res: Response
  try {
    res = await fetch(`${DIDIT_VERIFICATION_BASE}/session/`, {
      method: 'POST',
      headers: {
        'x-api-key': diditApiKey(),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' }
  }

  if (!res.ok) {
    return { ok: false, error: await parseError(res), status: res.status }
  }

  const data = (await res.json()) as DiditSession
  if (!data?.session_id || !data?.url) {
    return { ok: false, error: 'Didit response missing session_id/url' }
  }
  return { ok: true, data }
}

/**
 * Fetches the full decision for a session. Used as a reconciliation fallback
 * when a webhook never arrives (webhooks retry but can still be lost).
 */
export async function getDecision(
  sessionId: string,
): Promise<DiditResult<DiditDecision>> {
  let res: Response
  try {
    res = await fetch(
      `${DIDIT_VERIFICATION_BASE}/session/${encodeURIComponent(sessionId)}/decision/`,
      {
        method: 'GET',
        headers: { 'x-api-key': diditApiKey() },
        cache: 'no-store',
      },
    )
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' }
  }

  if (!res.ok) {
    return { ok: false, error: await parseError(res), status: res.status }
  }

  const data = (await res.json()) as DiditDecision
  return { ok: true, data }
}
