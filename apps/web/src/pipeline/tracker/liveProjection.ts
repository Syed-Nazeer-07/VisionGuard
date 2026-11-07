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
  /** Bridged optical miss; never new incident evidence. */
  isPredicted?: boolean;
  /** Last real optical observation; predictions must not refresh it. */
  lastOpticalAt?: number;
  /** Strong image evidence of a distinct freight cab/trailer, not just YOLO class confidence. */
  /** Original YOLO bus/truck evidence, not a colour-based guess. */
  classScores?: { bus: number; truck: number };
}

// When the optical pipeline stalls, expire old boxes quickly instead of
// painting them over unrelated background after a vehicle has departed.
export const MAX_TRACK_AGE_SEC = 0.22;
export const MAX_PROJECTION_SEC = 0.14;
export const MAX_PREDICTION_BRIDGE_SEC = 0.17;

/** Prevent late asynchronous inference responses from wiping fresh evidence. */
export function hasFreshOpticalObservation(
  observedTime: number | undefined | null, currentMediaTime: number,
): boolean {
  if (observedTime == null || !Number.isFinite(currentMediaTime)) return false;
  const age = currentMediaTime - observedTime;
  return Number.isFinite(age) && age >= -0.065 && age <= MAX_TRACK_AGE_SEC;
}

/** Shared edge-exit policy for optical updates, predictions and canvas paint.
 * Do not retain a box once its observed motion is carrying it off-screen. */
export function hasExitedVideoFrame(
  track: Pick<LiveTrack, 'x' | 'y' | 'w' | 'h' | 'vx' | 'vy'>,
  frameWidth: number,
  frameHeight: number,
): boolean {
  const { x, y, w, h, vx, vy } = track;
  if (![x, y, w, h, vx, vy, frameWidth, frameHeight].every(Number.isFinite) ||
      w <= 0 || h <= 0 || frameWidth <= 0 || frameHeight <= 0) return true;
  const left = x - w / 2, top = y - h / 2;
  const right = x + w / 2, bottom = y + h / 2;
  const visibleW = Math.max(0, Math.min(right, frameWidth) - Math.max(left, 0));
  const visibleH = Math.max(0, Math.min(bottom, frameHeight) - Math.max(top, 0));
  if (x < 0 || x > frameWidth || y < 0 || y > frameHeight ||
      visibleW * visibleH < w * h * 0.60) return true;
  // The box may still be mostly visible just as the vehicle reaches an edge.
  // When the *measured direction* points outwards, stop drawing immediately.
  const margin = Math.min(8, Math.max(2, Math.min(w, h) * 0.08));
  return (right >= frameWidth - margin && vx > 8) ||
    (left <= margin && vx < -8) ||
    (bottom >= frameHeight - margin && vy > 8) ||
    (top <= margin && vy < -8);
}

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
    if (track.isPredicted && (track.lastOpticalAt === undefined ||
        !Number.isFinite(track.lastOpticalAt) ||
        mediaTime - track.lastOpticalAt < -0.065 ||
        mediaTime - track.lastOpticalAt > MAX_PREDICTION_BRIDGE_SEC)) return [];

    // Predict only briefly between consecutive real detector observations.
    // Never grow boxes indefinitely during a stalled inference.
    const dt = Math.max(0, Math.min(age, MAX_PROJECTION_SEC));
    const cx = track.x + track.vx * dt;
    const cy = track.y + track.vy * dt;
    const projected = { ...track, x: cx, y: cy };
    if (hasExitedVideoFrame(projected, frameWidth, frameHeight)) return [];
    return [projected];
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
