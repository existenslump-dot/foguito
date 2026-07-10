/**
 * /admin/edit/[id] — admin-facing post editor.
 *
 * Renders the same client component as /dashboard/edit/[id]. The component
 * branches on the current user's `is_admin` flag internally (Modo Auditoría
 * vs user revision flow), so both routes just pipe params through. The
 * split exists so the URL reflects who's editing — admins land here from
 * /admin, users land on /dashboard/edit from their own panel.
 *
 * Server-side admin gate lives in layout.tsx next door.
 */
export { default } from '@/app/dashboard/edit/[id]/page'
