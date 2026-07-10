'use client'
import PostCreateForm from '@/components/PostCreateForm'

/**
 * Admin-mode wrapper for PostCreateForm.
 *
 * All form logic (40+ states, schedule editor, geo cascade, media uploader,
 * photo editor, target user picker, KYC gate) lives in
 * src/components/PostCreateForm.tsx; this page just instantiates it with
 * mode="admin".
 *
 * The adjacent layout.tsx (admin gate) blocks non-admins server-side before
 * this wrapper loads.
 */
export default function AdminCreatePostPage() {
  return <PostCreateForm mode="admin" />
}
