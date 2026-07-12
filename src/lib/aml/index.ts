import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getSanctionsProvider,
  type SanctionsStatus,
  type SanctionsSubjectType,
} from '@/lib/payouts/provider'
import { isSanctionsConfigured } from '@/lib/payouts/config'

// ─────────────────────────────────────────────────────────────────────────────
// Motor AML (PR-10) — una sola puerta para screenear cualquiera de las TRES
// superficies (creadora / consumidor / payout), dejar el trail append-only en
// `sanctions_screenings` y estampar la columna fast-path del sujeto.
//
// La app SIEMPRE screenea por acá (nunca `getSanctionsProvider().screen()`
// directo desde una ruta): así todo screen queda logueado + refleja el veredicto
// en el flag que gatea el flujo (money-in / money-out / onboarding). El provider
// sigue siendo fail-closed (stub jamás clarea en prod; vendor real tira sin
// cablear) — este motor no relaja esa postura, sólo la orquesta + persiste.
//
// TODAS las escrituras van por el cliente service-role (`getSupabaseAdmin()` en
// el caller): `sanctions_screenings` es deny-all y las columnas privilegiadas
// (`creators.sanctions_status`, `profiles.consumer_sanctions_status`) están
// guardeadas por trigger — un cliente `authenticated` no las puede tocar.
// ─────────────────────────────────────────────────────────────────────────────

export interface ScreenSubjectArgs {
  subjectType: SanctionsSubjectType
  subjectId: string
  legalName?: string | null
  country?: string | null
}

export interface ScreenSubjectResult {
  status: SanctionsStatus
  /** Referencia opaca del screen del vendor/stub. */
  ref: string
  /** Provider que resolvió el screen ('vendor' | 'stub'). */
  provider: string
}

/**
 * Screenea un sujeto, deja el trail y estampa su flag fast-path.
 *
 * Orden + resiliencia:
 *   1. `provider.screen(...)` — si TIRA, se PROPAGA (el caller decide fail-closed:
 *      502 / held; nunca un 'clear' silencioso).
 *   2. INSERT en `sanctions_screenings` (trail append-only). Un fallo del log NO
 *      debe perder el update del status → se loguea y se CONTINÚA.
 *   3. Update de la columna fast-path del sujeto:
 *        - creator | payout → `creators.sanctions_status` + `sanctions_screened_at`
 *          (keyed por `user_id`; el payout comparte beneficiaria con la creadora,
 *          así que su status también se refleja acá).
 *        - consumer → `profiles.consumer_sanctions_status` + `consumer_screened_at`
 *          (keyed por `id`).
 *      Un fallo del update SÍ tira (es la escritura load-bearing del gate): el
 *      caller lo trata como no-screeneado (fail-closed / lo cuenta como falla).
 *
 * NUNCA loguea PII (nombre legal / país) a la consola.
 */
export async function screenSubject(
  admin: SupabaseClient,
  args: ScreenSubjectArgs,
): Promise<ScreenSubjectResult> {
  const provider = getSanctionsProvider()

  // 1. Screen (un throw propaga — fail-closed en el caller).
  const screen = await provider.screen({
    subjectId: args.subjectId,
    subjectType: args.subjectType,
    legalName: args.legalName ?? null,
    country: args.country ?? null,
  })

  const nowIso = new Date().toISOString()

  // 2. Trail append-only (deny-all; sólo service-role). Best-effort: si falla el
  //    insert, NO se pierde el update del status (se loguea y se sigue).
  const { error: logErr } = await admin.from('sanctions_screenings').insert({
    subject_type: args.subjectType,
    subject_id: args.subjectId,
    status: screen.status,
    provider: provider.name,
    ref: screen.ref,
    screened_at: nowIso,
  })
  if (logErr) {
    // Sin PII: sólo tipo + id opaco + error.
    console.error('[aml] sanctions_screenings insert failed (non-fatal)', {
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      error: logErr,
    })
  }

  // 3. Anti-downgrade: SÓLO un vendor real puede sacar a un sujeto de 'hit'. Con el
  //    stub (sin vendor cableado, que en prod devuelve 'review' para todos) un
  //    'review'/'clear' NO baja un 'hit' ya persistido — espeja el `.neq hit` del
  //    cron y el "requiere revisión manual para salir" de la migración. Sin esto,
  //    re-screenear con el stub levantaría el hold de money-in de un sancionado.
  let effectiveStatus: SanctionsStatus = screen.status
  if (!isSanctionsConfigured() && screen.status !== 'hit') {
    const current = await currentStatus(admin, args)
    if (current === 'hit') effectiveStatus = 'hit'
  }

  // 4. Columna fast-path del gate. Un fallo acá SÍ tira (load-bearing).
  if (args.subjectType === 'consumer') {
    const { error } = await admin
      .from('profiles')
      .update({ consumer_sanctions_status: effectiveStatus, consumer_screened_at: nowIso })
      .eq('id', args.subjectId)
    if (error) {
      console.error('[aml] profiles.consumer_sanctions_status update failed', {
        subjectId: args.subjectId,
        error,
      })
      throw new Error('[aml] consumer status update failed')
    }
  } else {
    // 'creator' | 'payout' — misma beneficiaria (tabla creators, key user_id).
    const { error } = await admin
      .from('creators')
      .update({ sanctions_status: effectiveStatus, sanctions_screened_at: nowIso })
      .eq('user_id', args.subjectId)
    if (error) {
      console.error('[aml] creators.sanctions_status update failed', {
        subjectId: args.subjectId,
        error,
      })
      throw new Error('[aml] creator status update failed')
    }
  }

  return { status: effectiveStatus, ref: screen.ref, provider: provider.name }
}

/**
 * Lee el `sanctions_status` PERSISTIDO del sujeto — sólo para el anti-downgrade
 * (paso 3). Devuelve el crudo ('none'|'unscreened'|'clear'|'review'|'hit') o null.
 */
async function currentStatus(
  admin: SupabaseClient,
  args: ScreenSubjectArgs,
): Promise<string | null> {
  if (args.subjectType === 'consumer') {
    const { data } = await admin
      .from('profiles')
      .select('consumer_sanctions_status')
      .eq('id', args.subjectId)
      .maybeSingle<{ consumer_sanctions_status: string }>()
    return data?.consumer_sanctions_status ?? null
  }
  const { data } = await admin
    .from('creators')
    .select('sanctions_status')
    .eq('user_id', args.subjectId)
    .maybeSingle<{ sanctions_status: string }>()
  return data?.sanctions_status ?? null
}
