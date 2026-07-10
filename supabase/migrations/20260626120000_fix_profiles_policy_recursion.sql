-- ─────────────────────────────────────────────────────────────────────────
-- Fix: "infinite recursion detected in policy for relation profiles"
--
-- The original profiles_select_own / profiles_update_own policies checked
-- admin status with a sub-SELECT against profiles itself:
--
--   USING (id = auth.uid() OR EXISTS (
--     SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.is_admin = true))
--
-- Evaluating that sub-SELECT re-triggers the same SELECT policy on profiles,
-- which evaluates the sub-SELECT again → infinite recursion. Because every
-- other table's admin check also does `EXISTS (SELECT 1 FROM profiles ...)`,
-- this broke admin reads across the whole app, not just direct profile reads.
--
-- Fix: move the admin check into a SECURITY DEFINER function. It runs as the
-- function owner (bypasses RLS), so the inner read of profiles does not
-- re-enter the policy. Policies then call is_admin() with no recursion.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false);
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin());
