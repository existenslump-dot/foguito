'use client'
import { supabase } from '@/lib/supabase/client'
import { supabaseFetch } from '@/lib/supabase/direct'
import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { safeRedirectPath } from '@/lib/safe-redirect'

function AuthConfirmInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Validated via safeRedirectPath again because hash-fragment flows can
  // smuggle raw query strings — belt + suspenders.
  const rawRedirect = searchParams.get('redirect')
  const explicitRedirect = rawRedirect ? safeRedirectPath(rawRedirect, '') : ''

  useEffect(() => {
    // This page handles the hash fragment (#access_token=...). The SDK
    // auto-detects tokens in the URL hash on init — auth.getSession()
    // here triggers/awaits that detection. Stays on the SDK because the
    // hash → cookie write is core SDK behavior, not replayable from
    // direct.ts. The downstream profile lookup + slug write are migrated
    // to direct PostgREST so a hang on those doesn't trap the user
    // forever on the "Iniciando sesión..." screen.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        // Look up admin flag (so admins landing via Google OAuth without an
        // explicit redirect end up in /admin, not /dashboard) and
        // profile_slug (a missing slug means this is a fresh OAuth signup
        // that skipped the register form).
        type ProfileRow = { profile_slug: string | null; is_admin: boolean }
        const { data: profileRows, error: profileErr } = await supabaseFetch<ProfileRow[]>(
          `profiles?select=profile_slug,is_admin&id=eq.${encodeURIComponent(session.user.id)}&limit=1`,
        )
        const profile = profileRows?.[0] ?? null

        if (profileErr) console.error('[auth-confirm] profile lookup failed', profileErr)

        // Fresh OAuth user — seed profile_slug from the email local-part so
        // the user has a canonical URL from first login.
        if (!profile?.profile_slug) {
          const baseSlug = (session.user.email?.split('@')[0] || 'user')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
          const slug = baseSlug + '-' + session.user.id.slice(0, 6)
          const { error: slugErr } = await supabaseFetch(
            `profiles?id=eq.${encodeURIComponent(session.user.id)}`,
            { method: 'PATCH', body: { profile_slug: slug }, noReturn: true },
          )
          if (slugErr) console.error('[auth-confirm] slug setup failed', slugErr)
        }

        // Same destination priority as /auth/callback: explicit > admin > user.
        if (explicitRedirect) {
          router.replace(explicitRedirect)
        } else {
          router.replace(profile?.is_admin ? '/admin' : '/dashboard')
        }
      } else {
        router.replace('/ingresar?error=auth')
      }
    })
  }, [router, explicitRedirect])

  return (
    <div style={{
      background: 'var(--v-bg-base)', minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <p style={{
        fontFamily: "'Montserrat', sans-serif",
        color: 'var(--v-accent)', fontSize: '11px', fontWeight: 200,
        letterSpacing: '.22em', textTransform: 'uppercase',
      }}>
        Iniciando sesión...
      </p>
    </div>
  )
}

export default function AuthConfirm() {
  // Next 16 requires useSearchParams-using components to be wrapped in
  // a Suspense boundary so the prerender can stream the fallback while
  // the client reads the query string.
  return (
    <Suspense fallback={<div style={{ background: 'var(--v-bg-base)', minHeight: '100vh' }} />}>
      <AuthConfirmInner />
    </Suspense>
  )
}
