-- Create a private bucket for storing evidence
INSERT INTO storage.buckets (id, name, public) 
VALUES ('evidence', 'evidence', false)
ON CONFLICT (id) DO NOTHING;

-- RLS for evidence bucket
-- Only authenticated users (Admin, Authority) can insert/select
CREATE POLICY "Evidence is readable by all authenticated users" 
ON storage.objects FOR SELECT 
TO authenticated 
USING (bucket_id = 'evidence');

CREATE POLICY "Authorities and Admins can upload evidence" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'evidence' AND auth_user_role() IN ('Authority', 'Admin'));

CREATE POLICY "Authorities and Admins can update evidence" 
ON storage.objects FOR UPDATE 
TO authenticated 
USING (bucket_id = 'evidence' AND auth_user_role() IN ('Authority', 'Admin'));

CREATE POLICY "Authorities and Admins can delete evidence" 
ON storage.objects FOR DELETE 
TO authenticated 
USING (bucket_id = 'evidence' AND auth_user_role() IN ('Authority', 'Admin'));
