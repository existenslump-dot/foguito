'use client'
import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getUserId, signOut } from '@/lib/supabase/direct'

/**
 * Signs the user out after a configurable window of inactivity. Paired with
 * the session-cookie policy in src/lib/supabase/client.ts — together they
 * cover both vectors:
 *   - browser close  → session cookie dies → next visit requires login
 *   - idle in-session → this watcher fires signOut() after IDLE_MINUTES
 *
 * Mounts once at the root layout; early-returns when there's no session so
 * it costs nothing for anonymous visitors. Re-arms whenever the user
 * moves the mouse, types, scrolls, taps, or the tab regains visibility.
 */
const IDLE_MINUTES = 15
const IDLE_MS = IDLE_MINUTES * 60 * 1000

// Routes where auto-logout would be more disruptive than protective.
// /ingresar, /registro and /auth/callback run the login dance itself; /blocked
// is a landing for geo-blocked visitors (no session to drop).
const SKIP_PREFIXES = ['/ingresar', '/registro', '/auth', '/blocked']

export default function IdleLogout() {
  const router   = useRouter()
  const pathname = usePathname()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    const skip = SKIP_PREFIXES.some(p => pathname?.startsWith(p))
    if (skip) return

    // Gate on having a session — no point in wiring listeners for a visitor
    // who isn't logged in. Cookie read is synchronous + lock-free, so the
    // `setTimeout` timer arms on the current tick instead of racing with
    // whatever has the Supabase SDK auth-token lock.
    ;(() => {
      const userId = getUserId()
      if (cancelled || !userId) return
      activeRef.current = true
      resetTimer()
      const onActivity = () => resetTimer()
      const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
      events.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }))

      return () => {
        events.forEach(ev => window.removeEventListener(ev, onActivity))
      }
    })()

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(logout, IDLE_MS)
    }

    async function logout() {
      if (!activeRef.current) return
      activeRef.current = false
      // Direct signOut — SDK path could hang behind the auth-token lock,
      // leaving the idle user on a protected page indefinitely. direct
      // clears the cookie unconditionally even if the server ack drops.
      try { await signOut() } catch { /* cookie is cleared either way */ }
      // Send the user to /ingresar with a hint so the UI can show "Sesión
      // expirada por inactividad" instead of a silent redirect.
      router.push('/ingresar?expired=1')
    }

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [pathname, router])

  return null
}
