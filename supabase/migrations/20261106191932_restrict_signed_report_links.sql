-- Signed report download URLs are bearer capabilities; don't make their
-- containing rows visible to arbitrary signed-in Viewer accounts.
ALTER POLICY "Reports are readable by all" ON public.reports
USING (
  public.auth_user_role() IN ('Operator','Supervisor','Admin')
  OR generated_by = auth.uid()
);
ALTER POLICY "Scheduled reports readable by all staff" ON public.scheduled_reports
USING (
  public.auth_user_role() IN ('Operator','Supervisor','Admin')
  OR created_by = auth.uid()
);
NOTIFY pgrst, 'reload schema';
