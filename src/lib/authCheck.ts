import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Verify the current user is authenticated and has confirmed their email.
 * Returns the user object or null + an error response payload.
 */
export async function requireVerifiedUser(supabase: SupabaseClient) {
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, error: { message: 'No autorizado', status: 401 } } as const
  }

  if (!user.email_confirmed_at) {
    return { user: null, error: { message: 'Email no confirmado', status: 403 } } as const
  }

  return { user, error: null } as const
}
