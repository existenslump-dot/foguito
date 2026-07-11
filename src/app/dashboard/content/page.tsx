import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { listContentForCreator, type ContentSummary } from '@/lib/content'
import ContentCreateForm from '@/components/ContentCreateForm'

/**
 * /dashboard/content — the creator's content surface.
 *
 * Server component: reads her OWN content through the RLS-scoped anon+cookie
 * client (content_select allows creator_id = auth.uid()), then embeds the
 * client-side <ContentCreateForm/> (which POSTs to /api/content — the ONLY
 * write door; there is no client-side insert of `content`).
 *
 * Auth + the KYC 18+ gate are handled by the adjacent layout.tsx.
 */
export const dynamic = 'force-dynamic'

const MONO = { fontFamily: 'var(--v-font-ui)' } as const

function StatusPill({ label, tone }: { label: string; tone: 'accent' | 'muted' | 'success' | 'error' }) {
  const color =
    tone === 'success'
      ? 'text-[var(--v-success)] border-[var(--v-success)]/30'
      : tone === 'error'
        ? 'text-[var(--v-error)] border-[var(--v-error)]/30'
        : tone === 'accent'
          ? 'text-[var(--v-accent)] border-[var(--v-accent)]/25'
          : 'text-[var(--v-text-tertiary)] border-white/10'
  return (
    <span
      className={`text-[8px] font-normal tracking-[.22em] uppercase border px-2.5 py-1 rounded-[6px] ${color}`}
      style={MONO}
    >
      {label}
    </span>
  )
}

function statusTone(status: string): 'accent' | 'muted' | 'success' | 'error' {
  if (status === 'published') return 'success'
  if (status === 'rejected' || status === 'removed') return 'error'
  if (status === 'in_review') return 'accent'
  return 'muted'
}

export default async function DashboardContentPage() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/ingresar?redirect=/dashboard/content')

  const res = await listContentForCreator(supabase, user.id)
  const items: ContentSummary[] = res.ok ? res.content : []

  return (
    <main className="max-w-[860px] mx-auto px-5 py-10">
      <div className="mb-8 flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-[clamp(24px,4vw,34px)] font-normal text-[var(--v-accent)]">Mi Contenido</h1>
        <Link
          href="/dashboard"
          className="text-[9px] font-normal tracking-[.18em] uppercase text-[var(--v-text-tertiary)] hover:text-[var(--v-accent)] transition-colors"
          style={MONO}
        >
          ← Dashboard
        </Link>
      </div>

      <ContentCreateForm />

      <section className="mt-12">
        <h2 className="text-[clamp(18px,3vw,24px)] font-normal text-[var(--v-text-primary)] mb-5">
          Subido {items.length > 0 && <span className="text-[var(--v-text-tertiary)]">({items.length})</span>}
        </h2>

        {!res.ok && (
          <p className="text-[11px] font-normal text-[var(--v-error)]" style={MONO}>
            No se pudo cargar tu contenido: {res.error}
          </p>
        )}

        {res.ok && items.length === 0 ? (
          <p className="text-[11px] font-normal text-[var(--v-text-tertiary)]" style={MONO}>
            Todavía no subiste contenido.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((c) => (
              <div key={c.id} className="bg-[var(--v-bg-card)] border border-white/5 rounded-[6px] p-5">
                <div className="flex justify-between items-start flex-wrap gap-3">
                  <div>
                    <p className="text-[13px] font-normal text-[var(--v-text-primary)] mb-1">
                      {c.title || '(sin título)'}
                    </p>
                    <p className="text-[9px] font-normal text-[var(--v-text-tertiary)] tracking-[.1em]" style={MONO}>
                      {c.media_type ?? '—'} · {c.visibility}
                      {c.visibility === 'tier' && c.required_tier ? ` (${c.required_tier})` : ''}
                      {c.visibility === 'ppv' && c.ppv_price_credits ? ` (${c.ppv_price_credits} foguitos)` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusPill label={c.status} tone={statusTone(c.status)} />
                    <StatusPill
                      label={`CSAM: ${c.csam_status}`}
                      tone={c.csam_status === 'pass' ? 'success' : c.csam_status === 'blocked' ? 'error' : 'muted'}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-6 text-[9px] text-[var(--v-text-tertiary)] tracking-[.1em] leading-relaxed" style={MONO}>
          Todo el contenido pasa por revisión antes de publicarse: verificación 18+ / registro 2257 / escaneo
          de seguridad. Hasta entonces queda «uploaded» y no es visible para nadie.
        </p>
      </section>
    </main>
  )
}
