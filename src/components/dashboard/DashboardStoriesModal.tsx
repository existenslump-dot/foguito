// Stub — physical protection for the marketplace base SKU.
//
// The real DashboardStoriesModal ships in the Stories add-on and is NOT delivered
// in the base. This stub only satisfies the import + prop type so the app
// compiles; the feature is gated off (FEATURE_STORIES forced false), so it never
// mounts. See tooling/split/SPLIT.md.
import type { FC } from 'react'

const DashboardStoriesModal: FC<Record<string, unknown>> = () => null
export default DashboardStoriesModal
