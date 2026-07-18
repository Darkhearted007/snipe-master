
-- 1. Profiles: restrict SELECT to owner only
DROP POLICY IF EXISTS "profiles viewable by authenticated" ON public.profiles;
CREATE POLICY "users view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- 2. Discovery candidates: public read-only market data
CREATE POLICY "discovery candidates are public"
  ON public.discovery_candidates FOR SELECT TO anon, authenticated
  USING (true);
GRANT SELECT ON public.discovery_candidates TO anon;

-- 3. Move SECURITY DEFINER helpers off the public API surface
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

ALTER FUNCTION public.has_role(uuid, public.app_role) SET search_path = public;
ALTER FUNCTION public.has_role(uuid, public.app_role) SET SCHEMA private;

ALTER FUNCTION public.get_user_roles(uuid) SET search_path = public;
ALTER FUNCTION public.get_user_roles(uuid) SET SCHEMA private;

ALTER FUNCTION public.set_updated_at() SET SCHEMA private;
ALTER FUNCTION public.prune_stale_discovery_candidates() SET SCHEMA private;

-- Lock down execute privileges; grant only where needed
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.get_user_roles(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_user_roles(uuid) TO service_role;

REVOKE ALL ON FUNCTION private.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.prune_stale_discovery_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.prune_stale_discovery_candidates() TO service_role;

-- 4. Recreate user_roles policies referencing the moved has_role
DROP POLICY IF EXISTS "admins manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "users view own roles" ON public.user_roles;

CREATE POLICY "admins manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "users view own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));
