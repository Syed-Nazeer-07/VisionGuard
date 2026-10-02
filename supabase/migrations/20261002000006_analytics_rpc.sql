CREATE OR REPLACE FUNCTION get_analytics_summary(
  p_camera_id UUID DEFAULT NULL,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL,
  p_violation_type TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_traffic_volume INT;
  v_avg_speed FLOAT;
  v_peak_speed FLOAT;
  v_total_violations INT;
  v_overspeed_violations INT;
  v_active_alerts INT;
  
  v_violations_by_type JSON;
  v_violations_by_camera JSON;
  v_alerts_by_severity JSON;
  
  v_traffic_over_time JSON;
  v_violations_over_time JSON;
  v_alerts_over_time JSON;
  v_speed_distribution JSON;
  
  v_days_count FLOAT;
  v_hours_count FLOAT;
BEGIN
  -- Default dates to last 7 days if not provided
  IF p_start_date IS NULL THEN p_start_date := NOW() - INTERVAL '7 days'; END IF;
  IF p_end_date IS NULL THEN p_end_date := NOW(); END IF;
  
  v_days_count := EXTRACT(EPOCH FROM (p_end_date - p_start_date)) / 86400;
  IF v_days_count < 1 THEN v_days_count := 1; END IF;
  v_hours_count := v_days_count * 24;

  -- 1. Traffic Aggregates
  SELECT 
    COALESCE(SUM(vehicle_count), 0),
    COALESCE(AVG(avg_speed), 0)
  INTO v_traffic_volume, v_avg_speed
  FROM traffic_stats
  WHERE (p_camera_id IS NULL OR camera_id = p_camera_id)
    AND timestamp >= p_start_date 
    AND timestamp <= p_end_date;
    
  -- Peak speed (approximation from avg_speeds, or we could just take max)
  SELECT COALESCE(MAX(avg_speed), 0) INTO v_peak_speed
  FROM traffic_stats
  WHERE (p_camera_id IS NULL OR camera_id = p_camera_id)
    AND timestamp >= p_start_date 
    AND timestamp <= p_end_date;

  -- 2. Violations
  SELECT COUNT(*) INTO v_total_violations
  FROM violations
  WHERE (p_camera_id IS NULL OR camera_id = p_camera_id)
    AND (p_violation_type IS NULL OR type = p_violation_type)
    AND timestamp >= p_start_date 
    AND timestamp <= p_end_date;
    
  SELECT COUNT(*) INTO v_overspeed_violations
  FROM violations
  WHERE (p_camera_id IS NULL OR camera_id = p_camera_id)
    AND type = 'overspeed'
    AND (p_violation_type IS NULL OR type = p_violation_type)
    AND timestamp >= p_start_date 
    AND timestamp <= p_end_date;

  -- 3. Active Alerts
  SELECT COUNT(*) INTO v_active_alerts
  FROM alerts
  WHERE (p_camera_id IS NULL OR camera_id = p_camera_id)
    AND status = 'active'
    AND created_at >= p_start_date 
    AND created_at <= p_end_date;

  -- 4. Violations by Type
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_violations_by_type
  FROM (
    SELECT type as name, COUNT(*) as value
    FROM violations
    WHERE (p_camera_id IS NULL OR camera_id = p_camera_id)
      AND (p_violation_type IS NULL OR type = p_violation_type)
      AND timestamp >= p_start_date 
      AND timestamp <= p_end_date
    GROUP BY type
  ) t;
  
  -- Violations by Camera
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_violations_by_camera
  FROM (
    SELECT c.name as name, COUNT(v.*) as value
    FROM violations v
    JOIN cameras c ON c.id = v.camera_id
    WHERE (p_camera_id IS NULL OR v.camera_id = p_camera_id)
      AND (p_violation_type IS NULL OR v.type = p_violation_type)
      AND v.timestamp >= p_start_date 
      AND v.timestamp <= p_end_date
    GROUP BY c.name
  ) t;
  
  -- Alerts by Severity
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_alerts_by_severity
  FROM (
    SELECT severity as name, COUNT(*) as value
    FROM alerts
    WHERE (p_camera_id IS NULL OR camera_id = p_camera_id)
      AND created_at >= p_start_date 
      AND created_at <= p_end_date
    GROUP BY severity
  ) t;

  -- 5. Traffic Over Time (Group by day)
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_traffic_over_time
  FROM (
    SELECT TO_CHAR(DATE_TRUNC('day', timestamp), 'YYYY-MM-DD') as date, SUM(vehicle_count) as count
    FROM traffic_stats
    WHERE (p_camera_id IS NULL OR camera_id = p_camera_id)
      AND timestamp >= p_start_date 
      AND timestamp <= p_end_date
    GROUP BY DATE_TRUNC('day', timestamp)
    ORDER BY DATE_TRUNC('day', timestamp)
  ) t;

  -- 6. Violations Over Time
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_violations_over_time
  FROM (
    SELECT TO_CHAR(DATE_TRUNC('day', timestamp), 'YYYY-MM-DD') as date, COUNT(*) as count
    FROM violations
    WHERE (p_camera_id IS NULL OR camera_id = p_camera_id)
      AND (p_violation_type IS NULL OR type = p_violation_type)
      AND timestamp >= p_start_date 
      AND timestamp <= p_end_date
    GROUP BY DATE_TRUNC('day', timestamp)
    ORDER BY DATE_TRUNC('day', timestamp)
  ) t;

  -- 7. Alerts Over Time
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_alerts_over_time
  FROM (
    SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') as date, COUNT(*) as count
    FROM alerts
    WHERE (p_camera_id IS NULL OR camera_id = p_camera_id)
      AND created_at >= p_start_date 
      AND created_at <= p_end_date
    GROUP BY DATE_TRUNC('day', created_at)
    ORDER BY DATE_TRUNC('day', created_at)
  ) t;
  
  -- 8. Speed Distribution (Dummy buckets since we only have avg_speed per minute)
  -- Real implementation would bucket avg_speed
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_speed_distribution
  FROM (
    SELECT 
      CASE 
        WHEN avg_speed < 30 THEN '0-30'
        WHEN avg_speed < 50 THEN '30-50'
        WHEN avg_speed < 70 THEN '50-70'
        WHEN avg_speed < 90 THEN '70-90'
        ELSE '90+'
      END as speed_range,
      SUM(vehicle_count) as count
    FROM traffic_stats
    WHERE (p_camera_id IS NULL OR camera_id = p_camera_id)
      AND timestamp >= p_start_date 
      AND timestamp <= p_end_date
    GROUP BY 1
    ORDER BY 1
  ) t;

  RETURN json_build_object(
    'traffic_volume', v_traffic_volume,
    'vehicles_per_day', ROUND((v_traffic_volume / v_days_count)::numeric, 1),
    'vehicles_per_hour', ROUND((v_traffic_volume / v_hours_count)::numeric, 1),
    'avg_speed', ROUND(v_avg_speed::numeric, 1),
    'peak_speed', v_peak_speed,
    'total_violations', v_total_violations,
    'overspeed_rate', CASE WHEN v_traffic_volume > 0 THEN ROUND((v_overspeed_violations::numeric / v_traffic_volume * 100), 2) ELSE 0 END,
    'active_alerts', v_active_alerts,
    'violations_by_type', v_violations_by_type,
    'violations_by_camera', v_violations_by_camera,
    'alerts_by_severity', v_alerts_by_severity,
    'traffic_over_time', v_traffic_over_time,
    'violations_over_time', v_violations_over_time,
    'alerts_over_time', v_alerts_over_time,
    'speed_distribution', v_speed_distribution
  );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
