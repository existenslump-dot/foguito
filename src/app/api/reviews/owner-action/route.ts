// Stub — physical protection for the marketplace base SKU.
//
// The real owner-action route (review approve/reject/remove state machine) ships
// in the Reviews add-on and is NOT delivered in the base. This stub returns 404.
// See tooling/split/SPLIT.md.
import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
