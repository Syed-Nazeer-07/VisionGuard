/**
 * Backend speeding candidates are NOT confirmed traffic offences.
 *
 * A record links to the original video time and the exact run artifact frame.
 * The bounding box is an observed YOLO track, not a fabricated screenshot.
 * A trained human must verify calibration, scene, and vehicle before action.
 */

export interface BackendSpeedingEvent {
  event_id: string;
  track_id: number;
  frame_id: number;
  media_time: number;
  speed_kmh: number;
  speed_limit_kmh: number;
  tolerance_kmh: number;
  vehicle_class: string;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
  source_width: number;
  source_height: number;
  observation_type: 'detection';
  is_calibrated: boolean;
}

export interface BackendIncidentRow {
  incident_type: 'overspeed';
  violation_type: 'overspeed';
  severity: 'Medium';
  status: 'Active';
  confidence: number;
  track_id: number;
  camera_id: null;
  video_id: string;
  analysis_run_id: string;
  location: string;
  description: string;
  metadata: {
    review_required: true;
    review_status: 'pending_review';
    source_engine: 'backend';
    evidence_kind: 'video_frame_reference';
    snapshot_available: false;
    event_id: string;
    media_time: number;
    frame_id: number;
    track_id: number;
    speed: number;
    speed_limit: number;
    speed_tolerance: number;
    speed_trigger_threshold: number;
    speed_calibrated: true;
    vehicle_class: string;
    bbox: BackendSpeedingEvent['bbox'];
    source_width: number;
    source_height: number;
    detector_confidence: number;
    artifact_storage_path: string;
    artifact_bucket: string;
  };
}

function validNumber(v: number): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateEvent(event: BackendSpeedingEvent): void {
  if (!event || typeof event.event_id !== 'string' || !event.event_id.trim()) {
    throw new Error('Missing speeding event identifier');
  }
  if (!Number.isSafeInteger(event.track_id) || event.track_id < 1
      || !Number.isSafeInteger(event.frame_id) || event.frame_id < 1) {
    throw new Error('Invalid speeding event track/frame identifier');
  }
  if (!validNumber(event.media_time) || event.media_time < 0
      || !validNumber(event.speed_kmh) || !validNumber(event.speed_limit_kmh)
      || !validNumber(event.tolerance_kmh) || event.speed_limit_kmh <= 0 || event.tolerance_kmh < 0
      || event.speed_kmh <= event.speed_limit_kmh + event.tolerance_kmh) {
    throw new Error('Speeding event does not contain a valid over-limit measurement');
  }
  if (event.is_calibrated !== true || event.observation_type !== 'detection') {
    throw new Error('Uncalibrated or predicted tracks cannot create speeding incidents');
  }
  if (!validNumber(event.confidence) || event.confidence < 0 || event.confidence > 1
      || !event.bbox || ![event.bbox.x, event.bbox.y, event.bbox.w, event.bbox.h].every(validNumber)
      || event.bbox.w <= 0 || event.bbox.h <= 0
      || !validNumber(event.source_width) || !validNumber(event.source_height)
      || event.source_width <= 0 || event.source_height <= 0
      || typeof event.vehicle_class !== 'string' || !event.vehicle_class.trim()) {
    throw new Error('Missing observed vehicle evidence for speeding event');
  }
}

export function buildBackendSpeedIncidents(args: {
  events: readonly BackendSpeedingEvent[];
  videoId: string;
  runId: string;
  videoName: string;
  artifactPath: string;
  artifactBucket: string;
  reportedEventCount?: number;
}): BackendIncidentRow[] {
  const { events, videoId, runId, videoName, artifactPath, artifactBucket, reportedEventCount } = args;
  if (!videoId || !runId || !artifactPath || !artifactBucket) {
    throw new Error('Missing durable video/run artifact reference for speeding incidents');
  }
  if (reportedEventCount !== undefined && reportedEventCount !== events.length) {
    throw new Error('Speeding event count does not match the backend result summary');
  }
  const seen = new Set<string>();
  return events.map(event => {
    validateEvent(event);
    if (seen.has(event.event_id)) throw new Error('Duplicate backend speeding event');
    seen.add(event.event_id);
    const time = event.media_time.toFixed(2);
    return {
      incident_type: 'overspeed',
      violation_type: 'overspeed',
      severity: 'Medium',
      status: 'Active',
      confidence: event.confidence, // Object detection confidence, NOT speed accuracy
      track_id: event.track_id,
      camera_id: null,
      video_id: videoId,
      analysis_run_id: runId,
      location: `Video: ${videoName}`,
      description: `Potential speeding at video time ${time}s (track #${event.track_id}, ${event.speed_kmh.toFixed(1)} km/h; configured limit ${event.speed_limit_kmh} + ${event.tolerance_kmh} km/h tolerance). Requires human verification.`,
      metadata: {
        review_required: true,
        review_status: 'pending_review',
        source_engine: 'backend',
        evidence_kind: 'video_frame_reference',
        snapshot_available: false,
        event_id: event.event_id,
        media_time: event.media_time,
        frame_id: event.frame_id,
        track_id: event.track_id,
        speed: event.speed_kmh,
        speed_limit: event.speed_limit_kmh,
        speed_tolerance: event.tolerance_kmh,
        speed_trigger_threshold: event.speed_limit_kmh + event.tolerance_kmh,
        speed_calibrated: true,
        vehicle_class: event.vehicle_class,
        bbox: { ...event.bbox },
        source_width: event.source_width,
        source_height: event.source_height,
        detector_confidence: event.confidence,
        artifact_storage_path: artifactPath,
        artifact_bucket: artifactBucket,
      },
    };
  });
}
