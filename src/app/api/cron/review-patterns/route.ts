// Stub — physical protection for the marketplace base SKU.
//
// The real review-patterns cron (mass-bombing detection over anonymous reviews)
// ships in the Reviews add-on and is NOT delivered in the base. This stub is a
// no-op: reviews don't exist in the base, so there is nothing to sweep.
// See tooling/split/SPLIT.md.
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return Response.json({ ok: true, skipped: 'reviews_addon_not_installed' })
}
