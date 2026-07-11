import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/clients/require-user'
import { getViewerJurisdiction } from '@/lib/age-gate/viewer-geo'
import { requirementFor, jurisdictionKey } from '@/lib/age-gate/jurisdictions'
import { isAgeVerifyEnabled, isProduction } from '@/lib/age-gate/config'
import { getAgeVerifyProvider } from '@/lib/age-gate'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'

/**
 * POST /api/age-verify/start → { url }
 *
 * Starts a REAL age-verification session for the logged-in fan and returns the
 * provider's hosted URL to redirect to. Server-authoritative throughout:
 *   - the user id comes from the session (requireUser), never the body;
 *   - the jurisdiction is captured HERE from the VIEWER's Vercel geo headers
 *     (getViewerJurisdiction) so the resulting verification is scoped to the
 *     regime that required it — the client can't influence it.
 *
 * FAIL-CLOSED: where the jurisdiction demands verification and no vendor is
 * configured in PRODUCTION → 503 (we won't pretend to verify). Same-origin +
 * auth are enforced by requireUser. Molde: verification/didit-session.
 */
export async function POST(req: NextRequest) {
  const gate = await requireUser(req)
  if (!gate.ok) return gate.response
  const { userId } = gate

  const viewer = getViewerJurisdiction(req.headers)
  const requirement = requirementFor(viewer.country, viewer.region)
  const jKey = jurisdictionKey(viewer.country, viewer.region)

  // Nothing to verify for this jurisdiction (defensive — the default matrix
  // never returns 'none').
  if (requirement === 'none') {
    return NextResponse.json(
      { error: 'No age verification required for your region' },
      { status: 400 },
    )
  }

  // Fail-closed: verification is mandated but the real vendor isn't configured
  // in production → 503. (Outside production the stub can drive the flow.)
  if (!isAgeVerifyEnabled() && isProduction()) {
    return NextResponse.json(
      { error: 'Age verification is not available' },
      { status: 503 },
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  const callbackUrl = `${appUrl}/verificar-edad?return=1`

  let url: string
  try {
    const provider = getAgeVerifyProvider()
    const res = await provider.startVerification({ userId, jurisdiction: jKey, callbackUrl })
    url = res.url
  } catch (err) {
    // The stub throws in prod, and the didit skeleton throws without creds —
    // both surface here as a clean 502 rather than an opaque 500.
    console.error('[age-verify/start] provider failed:', err)
    return NextResponse.json({ error: 'Could not start age verification' }, { status: 502 })
  }

  void recordAudit({
    eventType: 'age_verify_started',
    actorRole: 'user',
    actorUserId: userId,
    subjectType: 'age_gate',
    subjectId: userId,
    req,
    metadata: {
      jurisdiction: jKey,
      requirement,
      provider: process.env.NEXT_PUBLIC_AGE_VERIFY_PROVIDER ?? 'stub',
    },
  })

  return NextResponse.json({ url })
}
