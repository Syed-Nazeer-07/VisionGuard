-- Add performance indexes for common query patterns

CREATE INDEX IF NOT EXISTS idx_violations_camera_id ON violations(camera_id);
CREATE INDEX IF NOT EXISTS idx_violations_timestamp ON violations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_violations_status ON violations(status);
CREATE INDEX IF NOT EXISTS idx_violations_type ON violations(type);

CREATE INDEX IF NOT EXISTS idx_alerts_camera_id ON alerts(camera_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);

CREATE INDEX IF NOT EXISTS idx_traffic_stats_camera_id ON traffic_stats(camera_id);
CREATE INDEX IF NOT EXISTS idx_traffic_stats_timestamp ON traffic_stats(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_camera_id ON analysis_runs(camera_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_started_at
ON analysis_runs(started_at DESC);

-- Also index evidence bucket objects if possible (Storage manages its own indexes)
