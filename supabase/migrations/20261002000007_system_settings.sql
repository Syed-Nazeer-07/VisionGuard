-- Migration for system_settings table

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Insert defaults
INSERT INTO system_settings (key, value) VALUES
  ('evidence_retention_days', '30'::jsonb),
  ('speed_limit_default', '60'::jsonb),
  ('speed_tolerance_default', '5'::jsonb),
  ('feature_speed_detection', 'true'::jsonb),
  ('feature_plate_detection', 'true'::jsonb),
  ('feature_helmet_detection', 'true'::jsonb),
  ('feature_triple_riding_detection', 'true'::jsonb),
  ('feature_red_light_detection', 'true'::jsonb),
  ('feature_lane_detection', 'true'::jsonb),
  ('feature_alerts', 'true'::jsonb),
  ('maintenance_mode', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- RLS Policies
-- Viewers have no access. Authority and Admin can select.
CREATE POLICY "Enable read for Authority and Admin" ON system_settings
  FOR SELECT USING (auth_user_role() IN ('Authority', 'Admin'));

-- Only Admin can update
CREATE POLICY "Enable update for Admin only" ON system_settings
  FOR UPDATE USING (auth_user_role() = 'Admin');

CREATE POLICY "Enable insert for Admin only" ON system_settings
  FOR INSERT WITH CHECK (auth_user_role() = 'Admin');
  
-- Create a realtime publication for settings
ALTER PUBLICATION supabase_realtime ADD TABLE system_settings;
