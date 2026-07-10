'use client'
import PostCreateForm from '@/components/PostCreateForm'

/**
 * Self-service wrapper for PostCreateForm.
 *
 * All form logic lives in src/components/PostCreateForm.tsx; this page just
 * instantiates it with mode="self-service".
 *
 * The adjacent layout.tsx gates auth + "1 active listing per account". There
 * is no KYC gate: a user publishes without verifying and verifies later from
 * /dashboard (verification gates the feed, not the upload).
 */
export default function DashboardCreatePostPage() {
  return <PostCreateForm mode="self-service" />
}
