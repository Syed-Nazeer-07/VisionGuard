import type { BoundingBox } from '../pipeline/types';
import type { PersistentTrack } from '../pipeline/tracker/stableVehicles';

/**
 * A paused, single-frame detector inspection is deliberately separate from
 * ByteTrack, optical flow, speed estimation and the persistent observation
 * ledger. Negative IDs prevent confusing these candidates with live tracks.
 */
export function inspectionTracks(
  detections: readonly BoundingBox[],
  mediaTime: number,
): PersistentTrack[] {
  if (!Number.isFinite(mediaTime) || mediaTime < 0) return [];
  return detections
    .filter(d => [d.x, d.y, d.w, d.h, d.prob].every(Number.isFinite) && d.w > 0 && d.h > 0)
    .map((box, index) => ({
      ...box,
      id: -index - 1,
      confidence: box.prob,
      vx: 0,
      vy: 0,
      motionPxPerSec: null,
      speedKmh: null,
      speedIsEstimate: true,
      lastDetectedAt: mediaTime,
      isPredicted: false,
    }));
}

export function isCurrentPausedInspection(
  requestedAt: number,
  videoTime: number,
  paused: boolean,
  seeking: boolean,
  active: boolean,
): boolean {
  return paused && !seeking && active &&
    Number.isFinite(requestedAt) && Number.isFinite(videoTime) &&
    Math.abs(requestedAt - videoTime) <= 0.025;
}
