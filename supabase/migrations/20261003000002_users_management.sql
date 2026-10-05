-- Upgrades to Profiles table for User Management module

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Active',
ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;

-- If a user is Disabled, they shouldn't be able to query most things, but RLS for that is complex 
-- and best handled at the application layer or by disabling the actual auth.users account using the Admin API.
-- For our demonstration and schema, we track it in profiles.
