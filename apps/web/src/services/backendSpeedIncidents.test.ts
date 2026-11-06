import { describe, expect, it } from 'vitest';
import { buildBackendSpeedIncidents, type BackendSpeedingEvent } from './backendSpeedIncidents';

const event: BackendSpeedingEvent = {
  event_id: 'track-2-frame-90',
  track_id: 2,
  frame_id: 90,
  media_time: 3,
  speed_kmh: 83.1,
  speed_limit_kmh: 60,
  tolerance_kmh: 10,
  vehicle_class: 'car',
  confidence: 0.91,
  bbox: { x: 120, y: 200, w: 70, h: 40 },
  source_width: 640,
  source_height: 360,
  observation_type: 'detection',
  is_calibrated: true,
};
const args = {
  events: [event], videoId: 'video-id', runId: 'run-id',
  videoName: 'traffic.mp4', artifactPath: 'artifacts/video-id/run-id.json.gz',
  artifactBucket: 'videos', reportedEventCount: 1
};

describe('backend speeding incident construction', () => {
  it('creates a reviewable unverified incident with authentic frame provenance', () => {
    const [row] = buildBackendSpeedIncidents(args);
    expect(row).toMatchObject({
      incident_type: 'overspeed', status: 'Active', track_id: 2,
      analysis_run_id: 'run-id', video_id: 'video-id',
      metadata: {
        review_required: true, review_status: 'pending_review',
        evidence_kind: 'video_frame_reference', snapshot_available: false,
        frame_id: 90, media_time: 3,
        speed: 83.1, speed_limit: 60, speed_tolerance: 10,
        detector_confidence: 0.91,
        artifact_storage_path: 'artifacts/video-id/run-id.json.gz'
      }
    });
    expect(row.description).toContain('Requires human verification');
  });
  it('does not invent incidents for zero events', () => {
    expect(buildBackendSpeedIncidents({ ...args, events: [], reportedEventCount: 0 })).toEqual([]);
  });
  it('rejects uncalibrated or predicted observations', () => {
    expect(() => buildBackendSpeedIncidents({ ...args, events: [{ ...event, is_calibrated: false }] }))
      .toThrow('Uncalibrated');
    expect(() => buildBackendSpeedIncidents({ ...args, events: [{ ...event, observation_type: 'predicted' as any }] }))
      .toThrow('Uncalibrated');
  });
  it('rejects speeds below the configured tolerance threshold', () => {
    expect(() => buildBackendSpeedIncidents({ ...args, events: [{ ...event, speed_kmh: 69 }] })).toThrow('over-limit');
  });
  it('rejects mismatched summary totals, missing artifact and duplicate events', () => {
    expect(() => buildBackendSpeedIncidents({ ...args, reportedEventCount: 2 })).toThrow('count');
    expect(() => buildBackendSpeedIncidents({ ...args, artifactPath: '' })).toThrow('artifact');
    expect(() => buildBackendSpeedIncidents({ ...args, events: [event, event], reportedEventCount: 2 }))
      .toThrow('Duplicate');
  });
});
