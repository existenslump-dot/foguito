import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/clients/supabase-admin'
import { MARKETPLACE } from '@/config/marketplace.config'

// Cache TTL: 6 hours. Frankfurter's ECB data only refreshes once per business day,
// so checking more often is wasted calls. We UPDATE cached rows in place, never
// INSERT new ones — the cached row count matches TARGETS.length.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
// Hard ceiling on how stale a cached rate can be before we stop serving it.
// If Frankfurter is down AND the last successful fetch is older than this
// (three full business days' worth of buffer), the price the user would see
// could be wildly off and we'd rather 503 than quote them a fake figure.
const CACHE_MAX_AGE_MS = 72 * 60 * 60 * 1000

// Target currencies to fetch USD→X rates for: the deployment's market currency
// (config-driven). Frankfurter's base here is USD, so USD itself needs no
// conversion — a USD market has an empty target list and short-circuits.
const TARGETS = Array.from(new Set([MARKETPLACE.market.currency])).filter(c => c !== 'USD')
const FRANKFURTER_URL = `https://api.frankfurter.dev/v1/latest?from=USD&to=${TARGETS.join(',')}`

type RateRow = { currency: string; rate: number; updated_at: string }

export const dynamic = 'force-dynamic' // always execute — caching is in DB, not edge

export async function GET() {
  // Base-currency market (USD): nothing to convert, no external call or DB needed.
  if (TARGETS.length === 0) {
    return NextResponse.json({ rates: {}, updated_at: null, cached: false, message: 'Base currency is USD; no conversion needed' })
  }

  let admin
  try {
    admin = getSupabaseAdmin()
  } catch (err) {
    console.error('[exchange-rates]', err)
    return NextResponse.json(
      { error: 'Server misconfigured: missing Supabase credentials' },
      { status: 500 },
    )
  }

  // 1. Read current cache
  const { data: rows, error: readErr } = await admin
    .from('exchange_rates')
    .select('currency, rate, updated_at')
    .in('currency', TARGETS)

  if (readErr) {
    console.error('[exchange-rates] DB read failed:', readErr)
    return NextResponse.json({ error: 'DB read failed' }, { status: 500 })
  }

  const now = Date.now()
  const cacheValid =
    rows &&
    rows.length >= TARGETS.length &&
    rows.every((r: RateRow) => r.rate > 0) &&
    rows.every((r: RateRow) => {
      const ageMs = now - new Date(r.updated_at).getTime()
      return ageMs < CACHE_TTL_MS
    })

  if (cacheValid && rows) {
    const rates = Object.fromEntries(rows.map((r: RateRow) => [r.currency, Number(r.rate)]))
    const freshest = rows.reduce(
      (a: RateRow, b: RateRow) =>
        new Date(a.updated_at) > new Date(b.updated_at) ? a : b,
    )
    return NextResponse.json({
      rates,
      updated_at: freshest.updated_at,
      cached: true,
      message: 'Rates from cache (< 6h)',
    })
  }

  // 2. Cache expired or empty → fetch from Frankfurter
  try {
    const fxRes = await fetch(FRANKFURTER_URL, { cache: 'no-store' })
    if (!fxRes.ok) throw new Error(`Frankfurter HTTP ${fxRes.status}`)
    const fxJson = (await fxRes.json()) as { rates?: Record<string, number> }
    const fresh = fxJson.rates
    if (!fresh || !TARGETS.every(c => fresh[c])) {
      throw new Error('Frankfurter returned incomplete rates')
    }

    const updatedAt = new Date().toISOString()
    // UPSERT — keeps the row-per-target invariant even if rows were deleted manually
    const upserts = TARGETS.map(c => ({
      currency: c,
      rate: fresh[c],
      updated_at: updatedAt,
    }))
    const { error: upErr } = await admin
      .from('exchange_rates')
      .upsert(upserts, { onConflict: 'currency' })
    if (upErr) console.error('[exchange-rates] DB upsert failed:', upErr)

    return NextResponse.json({
      rates: Object.fromEntries(TARGETS.map(c => [c, fresh[c]])),
      updated_at: updatedAt,
      cached: false,
      message: 'Rates refreshed from Frankfurter (ECB)',
    })
  } catch (err) {
    console.error('[exchange-rates] Frankfurter fetch failed:', err)
    // 3. Fallback — serve the DB cache only if it's not *too* stale.
    // Previously we'd return any cached row no matter how old; that meant
    // a weeks-old rate could be quoted to a payer while Frankfurter was down.
    // Now we bound the age at CACHE_MAX_AGE_MS and 503 beyond that so the UI can
    // at least tell the user prices are temporarily unknown.
    if (rows && rows.length > 0) {
      const freshest = rows.reduce(
        (a: RateRow, b: RateRow) =>
          new Date(a.updated_at) > new Date(b.updated_at) ? a : b,
      )
      const freshestAge = now - new Date(freshest.updated_at).getTime()
      if (freshestAge <= CACHE_MAX_AGE_MS) {
        const rates = Object.fromEntries(rows.map((r: RateRow) => [r.currency, Number(r.rate)]))
        return NextResponse.json({
          rates,
          updated_at: freshest.updated_at,
          cached: true,
          message: 'Rates from cache (fallback — external API unavailable)',
        })
      }
      console.error('[exchange-rates] cache too stale to serve', { ageMs: freshestAge })
      return NextResponse.json(
        { error: 'Exchange rates stale and external API unavailable' },
        { status: 503 },
      )
    }
    return NextResponse.json(
      { error: 'Exchange rates unavailable and no cache present' },
      { status: 503 },
    )
  }
}
