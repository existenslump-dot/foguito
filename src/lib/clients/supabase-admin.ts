import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client for server-side API routes.
 *
 * Node runtime caches module evaluation per worker, so this `createClient`
 * call happens at most once per Vercel serverless instance (instead of per
 * request — which was ~150 ms of handshake overhead we were paying on every
 * webhook, cron, and admin call).
 *
 * Rules:
 *   - NEVER import this from a Client Component. The service-role key
 *     bypasses RLS and must never reach the browser.
 *   - Sessions aren't persisted — this client is stateless per invocation.
 *   - If either env var is missing we throw immediately. Swallowing missing
 *     env vars was previously leading to opaque 500s at runtime.
 */

let cached: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached

  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('[supabase-admin] NEXT_PUBLIC_SUPABASE_URL is not set')
  }
  if (!serviceKey) {
    throw new Error('[supabase-admin] SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}

/**
 * Anon Supabase client for server-side routes that should respect RLS
 * (e.g. public reads that don't need elevated permissions). Still cached
 * once per worker — avoid calling createClient per request.
 */

let cachedAnon: SupabaseClient | null = null

export function getSupabaseAnon(): SupabaseClient {
  if (cachedAnon) return cachedAnon

  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anon) {
    throw new Error('[supabase-anon] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  cachedAnon = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cachedAnon
}
