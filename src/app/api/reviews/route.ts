// Stub — physical protection for the marketplace base SKU.
//
// The real reviews API (submission, doxxing/honeypot checks, IP-hashed anti-abuse,
// dual-stage moderation) ships in the Reviews add-on and is NOT delivered in the
// base. This stub returns 404 so no review can be read or created. The feature is
// also gated off (FEATURE_REVIEWS forced false). See tooling/split/SPLIT.md.
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}

export async function POST() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
