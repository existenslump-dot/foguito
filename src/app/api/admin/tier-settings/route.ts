import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { requireAdmin } from '@/lib/clients/require-admin'
import { AdminTierSettingsSchema, validationError } from '@/lib/validation/schemas'
import { logAudit } from '@/lib/auditLog'

export const runtime = 'nodejs'

/**
 * PATCH /api/admin/tier-settings
 * Body: { tier_slug: 'elite'|'gold'|'silver'|'bronze'|'basic', is_active: boolean }
 *
 * Flips a tier on/off for the public pricing page and the admin tier selector.
 * Existing posts keep their current tier — this only gates new assignments.
 *
 * Tier visibility is a product-gating lever (it determines who can pick a
 * tier at post-creation time), so every change is logged via logAudit + a
 * [tier-settings] prefixed console.error on failure. If a tier is
 * accidentally flipped off and revenue drops, the audit_log row tells us
 * who did it and when.
 */
export async function PATCH(req: NextRequest) {
  try {
    const gate = await requireAdmin(req)
    if (!gate.ok) return gate.response

    const parsed = AdminTierSettingsSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 })
    }
    const { tier_slug, is_active } = parsed.data

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
              || req.headers.get('x-real-ip')
              || undefined

    const admin = getSupabaseAdmin()

    // Capture the previous is_active before the upsert so the audit entry
    // records what actually changed, not just the new state. Missing row
    // means "first write" — recorded as previous_state: null.
    const { data: previousRow, error: previousErr } = await admin
      .from('tier_settings')
      .select('is_active')
      .eq('tier_slug', tier_slug)
      .maybeSingle()
    if (previousErr) {
      console.error('[tier-settings] previous state lookup failed', {
        tier_slug, admin_id: gate.userId,
        code: previousErr.code, message: previousErr.message,
      })
      // Don't bail — the upsert is still authoritative; we just lose the
      // delta field in audit metadata.
    }
    const previousState = previousRow?.is_active ?? null

    const { error } = await admin
      .from('tier_settings')
      .upsert(
        { tier_slug, is_active, updated_at: new Date().toISOString() },
        { onConflict: 'tier_slug' },
      )

    if (error) {
      console.error('[tier-settings] upsert failed', {
        tier_slug, is_active, admin_id: gate.userId,
        code: error.code, message: error.message, details: error.details,
      })
      // Generic message to client — internals stay in the logs.
      return NextResponse.json(
        { error: 'No se pudo actualizar el tier. Intentá de nuevo.' },
        { status: 500 },
      )
    }

    // Fire-and-forget audit log; do not block the response on its outcome.
    // logAudit swallows its own errors into console.error, so the caller
    // never sees a throw from here.
    void logAudit({
      userId: gate.userId,
      action: 'admin_action',
      resource: `tier_settings:${tier_slug}`,
      metadata: { is_active, previous_state: previousState },
      ipAddress: ip,
    })

    return NextResponse.json({ success: true, tier_slug, is_active })
  } catch (err) {
    console.error('[tier-settings] unexpected error', err)
    // Generic message — don't leak raw internals to the client.
    return NextResponse.json(
      { error: 'Error interno. Intentá de nuevo.' },
      { status: 500 },
    )
  }
}
