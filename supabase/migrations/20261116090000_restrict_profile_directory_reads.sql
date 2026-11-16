-- Limit profile-directory reads to the account owner and staff.
-- The previous SELECT policy USING (true) exposed names, emails and profile
-- metadata for every account to any signed-in Viewer through the Data API.
--
-- Operator/Supervisor/Admin retain directory reads for legacy case assignment
-- and the admin Users screen. Non-staff users can still read/update their own
-- profile. auth_user_role() reads only auth.uid() and runs as SECURITY DEFINER
-- to avoid recursive profiles RLS evaluation.

DROP POLICY IF EXISTS "Profiles are readable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Profiles readable by owner or staff" ON public.profiles;

CREATE POLICY "Profiles readable by owner or staff"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR (SELECT public.auth_user_role()) IN ('Operator', 'Supervisor', 'Admin')
  );
