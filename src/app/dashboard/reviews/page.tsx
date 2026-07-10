// Stub — physical protection for the marketplace base SKU.
//
// The real owner reviews queue ships in the Reviews add-on and is NOT delivered
// in the base. This stub is a server component that redirects to the dashboard;
// the feature is gated off (FEATURE_REVIEWS forced false). See tooling/split/SPLIT.md.
import { redirect } from 'next/navigation'

export default function OwnerReviewsPage() {
  redirect('/dashboard')
}
