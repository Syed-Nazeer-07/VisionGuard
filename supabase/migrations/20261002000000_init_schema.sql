-- Create Tables

-- 1. Profiles
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'Viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Cameras
CREATE TABLE public.cameras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  stream_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id)
);

-- 3. Scene Profiles
CREATE TABLE public.scene_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id UUID REFERENCES public.cameras(id) ON DELETE CASCADE NOT NULL,
  roi_polygon JSONB,
  calibration_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Analysis Runs
CREATE TABLE public.analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id UUID REFERENCES public.cameras(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  metrics JSONB
);

-- 5. Violations
CREATE TABLE public.violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id UUID REFERENCES public.cameras(id) ON DELETE CASCADE NOT NULL,
  analysis_run_id UUID REFERENCES public.analysis_runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  snapshot_url TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending'
);

-- 6. Traffic Stats
CREATE TABLE public.traffic_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id UUID REFERENCES public.cameras(id) ON DELETE CASCADE NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vehicle_count INT NOT NULL DEFAULT 0,
  avg_speed FLOAT
);

-- 7. Alerts
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Saved Reports
CREATE TABLE public.saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  config JSONB NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Activity Logs
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_cameras_status ON public.cameras(status);
CREATE INDEX idx_scene_profiles_camera_id ON public.scene_profiles(camera_id);
CREATE INDEX idx_analysis_runs_camera_id ON public.analysis_runs(camera_id);
CREATE INDEX idx_violations_camera_id ON public.violations(camera_id);
CREATE INDEX idx_violations_timestamp ON public.violations(timestamp DESC);
CREATE INDEX idx_violations_status ON public.violations(status);
CREATE INDEX idx_traffic_stats_camera_id ON public.traffic_stats(camera_id);
CREATE INDEX idx_traffic_stats_timestamp ON public.traffic_stats(timestamp DESC);
CREATE INDEX idx_alerts_is_read ON public.alerts(is_read);
CREATE INDEX idx_activity_logs_user_id ON public.activity_logs(user_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cameras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to get role from jwt
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb->'user_metadata'->>'role', '')::TEXT;
$$;

-- RLS Policies

-- Profiles: Users can read all profiles (needed for UI), but only update their own unless Admin.
CREATE POLICY "Profiles are readable by authenticated users" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR ALL TO authenticated USING (auth_user_role() = 'Admin');

-- Cameras: All authenticated users can view. Admins/Authorities can modify.
CREATE POLICY "Cameras are readable by all" ON public.cameras FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authorities and Admins can insert/update cameras" ON public.cameras FOR ALL TO authenticated USING (auth_user_role() IN ('Authority', 'Admin'));

-- Scene Profiles: Readable by all, modified by Authority/Admin
CREATE POLICY "Scene profiles readable by all" ON public.scene_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authorities and Admins can modify scene profiles" ON public.scene_profiles FOR ALL TO authenticated USING (auth_user_role() IN ('Authority', 'Admin'));

-- Analysis Runs: Readable by all, modified by Authority/Admin
CREATE POLICY "Analysis runs readable by all" ON public.analysis_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authorities and Admins can modify analysis runs" ON public.analysis_runs FOR ALL TO authenticated USING (auth_user_role() IN ('Authority', 'Admin'));

-- Violations: Readable by all, modified by Authority/Admin
CREATE POLICY "Violations readable by all" ON public.violations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authorities and Admins can modify violations" ON public.violations FOR ALL TO authenticated USING (auth_user_role() IN ('Authority', 'Admin'));

-- Traffic Stats: Readable by all, inserted by Authority/Admin
CREATE POLICY "Traffic stats readable by all" ON public.traffic_stats FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authorities and Admins can insert traffic stats" ON public.traffic_stats FOR INSERT TO authenticated WITH CHECK (auth_user_role() IN ('Authority', 'Admin'));

-- Alerts: Readable by all, modified by Authority/Admin
CREATE POLICY "Alerts readable by all" ON public.alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authorities and Admins can modify alerts" ON public.alerts FOR ALL TO authenticated USING (auth_user_role() IN ('Authority', 'Admin'));

-- Saved Reports: Users can manage their own reports
CREATE POLICY "Saved reports readable by owner or admins" ON public.saved_reports FOR SELECT TO authenticated USING (auth.uid() = created_by OR auth_user_role() = 'Admin');
CREATE POLICY "Users can insert own reports" ON public.saved_reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can update/delete own reports" ON public.saved_reports FOR UPDATE TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "Users can delete own reports" ON public.saved_reports FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Activity Logs: Admins can see all, users can see their own. System (Authorities/Admins) can insert.
CREATE POLICY "Activity logs viewable by owner or admin" ON public.activity_logs FOR SELECT TO authenticated USING (auth.uid() = user_id OR auth_user_role() = 'Admin');
CREATE POLICY "Users can insert activity logs" ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Profile Auto-Creation Trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'Viewer')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
