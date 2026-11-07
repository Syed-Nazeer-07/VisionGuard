-- Prevent ordinary users from editing server-owned authorization fields.
-- This remains compatible with existing authenticated profile edits (name,
-- avatar, organization, timezone) and legitimate Admin role management.
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Profile ownership cannot be changed' USING ERRCODE = '42501';
  END IF;

  IF current_user NOT IN ('postgres', 'service_role')
     AND (
       NEW.role IS DISTINCT FROM OLD.role OR
       NEW.status IS DISTINCT FROM OLD.status OR
       NEW.email IS DISTINCT FROM OLD.email OR
       NEW.created_at IS DISTINCT FROM OLD.created_at OR
       NEW.last_login IS DISTINCT FROM OLD.last_login OR
       NEW.invited_at IS DISTINCT FROM OLD.invited_at OR
       NEW.invited_by IS DISTINCT FROM OLD.invited_by OR
       NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
     )
     AND COALESCE(public.auth_user_role(), 'Viewer') <> 'Admin'
  THEN
    RAISE EXCEPTION 'Only administrators may update account permissions or status'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_privileged_fields ON public.profiles;
CREATE TRIGGER guard_profile_privileged_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_fields();

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id AND
    (role = public.auth_user_role() OR public.auth_user_role() = 'Admin'));
