/**
 * Display-time projection for continuously playing video.
 * Inference can be much slower than the browser's paint rate; these helpers
 * are intentionally stateless and NEVER turn stale detections into fake boxes.
 */
export interface LiveTrack {
  id: number;
  className: string;
  confidence: number;
  x: number; // center X in ORIGINAL video pixels
  y: number; // center Y in ORIGINAL video pixels
  w: number;
  h: number;
  vx: number; // image motion, source px / media-second
  vy: number;
  motionPxPerSec: number | null;
  /** Strong image evidence of a distinct freight cab/trailer, not just YOLO class confidence. */
  /** Original YOLO bus/truck evidence, not a colour-based guess. */
  classScores?: { bus: number; truck: number };
}

export const MAX_TRACK_AGE_SEC = 0.55;
export const MAX_PROJECTION_SEC = 0.35;

export function projectLiveTracks(
  tracks: readonly LiveTrack[],
  observedTime: number,
  mediaTime: number,
  frameWidth: number,
  frameHeight: number,
): LiveTrack[] {
  const age = mediaTime - observedTime;
  if (
    !Number.isFinite(age) || age < -0.065 || age > MAX_TRACK_AGE_SEC ||
    frameWidth <= 0 || frameHeight <= 0
  ) return [];

  return tracks.flatMap((track) => {
    if (![track.x, track.y, track.w, track.h, track.vx, track.vy].every(Number.isFinite)) return [];
    const twoWheeler = track.className === 'motorcycle' || track.className === 'bicycle';
    const minimumSize = twoWheeler ? 4 : 7;
    const minimumConfidence = track.className === 'motorcycle' ? .28 :
      track.className === 'bicycle' ? .33 : .42;
    if (track.w < minimumSize || track.h < minimumSize ||
        track.confidence < minimumConfidence) return [];

    // Predict only briefly between consecutive real detector observations.
    // Never grow boxes indefinitely during a stalled inference.
    const dt = Math.max(0, Math.min(age, MAX_PROJECTION_SEC));
    const cx = track.x + track.vx * dt;
    const cy = track.y + track.vy * dt;
    const left = cx - track.w / 2;
    const top = cy - track.h / 2;
    const right = cx + track.w / 2;
    const bottom = cy + track.h / 2;
    const visibleWidth = Math.min(right, frameWidth) - Math.max(left, 0);
    const visibleHeight = Math.min(bottom, frameHeight) - Math.max(top, 0);
    if (visibleWidth <= 0 || visibleHeight <= 0) return [];
    const fractionVisible = (visibleWidth * visibleHeight) / (track.w * track.h);
    // Departing vehicles disappear as soon as most of the object is outside the frame.
    if (fractionVisible < 0.25) return [];
    return [{ ...track, x: cx, y: cy }];
  });
}

export function calculateMotion(
  previous: { x: number; y: number; h: number; time: number; vx: number; vy: number } | undefined,
  current: { x: number; y: number; h: number },
  mediaTime: number,
): { vx: number; vy: number; motionPxPerSec: number | null } {
  if (!previous) return { vx: 0, vy: 0, motionPxPerSec: null };
  const elapsed = mediaTime - previous.time;
  if (elapsed < 0.035 || elapsed > 1.5) return { vx: 0, vy: 0, motionPxPerSec: null };
  const vxMeasured = (current.x - previous.x) / elapsed;
  // Use bottom-center (ground contact), not the bounding-box center, for 2D motion.
  const vyMeasured = (current.y + current.h / 2 - previous.y - previous.h / 2) / elapsed;
  // Smooth noisy detections rather than jittering the box and speed label.
  const vx = previous.vx * 0.40 + vxMeasured * 0.60;
  const vy = previous.vy * 0.40 + vyMeasured * 0.60;
  const magnitude = Math.hypot(vx, vy);
  if (!Number.isFinite(magnitude) || magnitude > 5000) return { vx: 0, vy: 0, motionPxPerSec: null };
  return { vx, vy, motionPxPerSec: magnitude };
}
