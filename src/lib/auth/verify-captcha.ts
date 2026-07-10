/**
 * Shared captcha verification helper.
 *
 * Called by any server route that accepts a Turnstile/hCaptcha token and
 * needs to re-verify it against the provider. Centralized so new endpoints
 * get the same timeout, fallback order (Turnstile → hCaptcha), and error
 * logging automatically.
 *
 * IMPORTANT: captcha tokens are single-use. Do NOT call this from a route
 * that is upstream of a Supabase auth call — Supabase validates the token
 * itself and would fail if we've already consumed it. Safe to use on
 * endpoints that don't chain into Supabase auth (e.g. contact forms,
 * signup availability checks).
 */
export type VerifyCaptchaResult =
  | { ok: true }
  | { ok: false; reason: 'missing-token' | 'no-secret-configured' | 'verify-failed' | 'verify-error' }

async function postForm(url: string, body: Record<string, string>): Promise<unknown> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(5000),
  })
  return r.json()
}

export async function verifyCaptcha(token: string | undefined | null): Promise<VerifyCaptchaResult> {
  if (!token) return { ok: false, reason: 'missing-token' }

  const turnstileSecret = process.env.TURNSTILE_SECRET || process.env.TURNSTILE_SECRET_KEY
  if (turnstileSecret) {
    try {
      const d = await postForm(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        { secret: turnstileSecret, response: token },
      ) as { success?: boolean }
      return d.success ? { ok: true } : { ok: false, reason: 'verify-failed' }
    } catch (err) {
      console.error('[verify-captcha] turnstile verify failed', err)
      return { ok: false, reason: 'verify-error' }
    }
  }

  const hcSecret = process.env.HCAPTCHA_SECRET
  if (hcSecret) {
    try {
      const d = await postForm(
        'https://hcaptcha.com/siteverify',
        { secret: hcSecret, response: token },
      ) as { success?: boolean }
      return d.success ? { ok: true } : { ok: false, reason: 'verify-failed' }
    } catch (err) {
      console.error('[verify-captcha] hcaptcha verify failed', err)
      return { ok: false, reason: 'verify-error' }
    }
  }

  // Callers get to decide policy. Most legacy callers treat this as "accept"
  // so feature flags can disable captcha in local dev; preserving that by
  // exposing the reason rather than hardcoding ok:true.
  return { ok: false, reason: 'no-secret-configured' }
}
