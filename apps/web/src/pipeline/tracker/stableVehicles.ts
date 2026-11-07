import type { LiveTrack } from './liveProjection';
import { getIOU } from './matching';

export interface PersistentTrack extends LiveTrack {
  lastDetectedAt: number;
  speedKmh: number | null;
  speedIsEstimate: boolean;
  classVotes?: Record<string, number>;
  /** Most recent frame with a reliable visual match (not a predicted position). */
  lastOpticalAt?: number;
  /** Short-lived prediction is display-only and must not drive measured speed. */
  isPredicted?: boolean;
}
export interface TrajectoryPoint { time: number; x: number; y: number }
export interface SpeedHistory {
  points: TrajectoryPoint[];
  smoothedKmh: number | null;
}
const PHYSICAL_WIDTH_METERS: Record<string, number> = {
  bicycle: 0.65,
  motorcycle: 0.80,
  car: 1.82,
  bus: 2.55,
  truck: 2.50,
  train: 2.85,
  'bus/truck': 2.55,
};
function classFamily(value: string): string {
  return ['car', 'bus', 'truck', 'bus/truck'].includes(value) ? 'motor-vehicle' : value;
}
function finiteTrack(t: LiveTrack) {
  const minimum = t.className === 'motorcycle' || t.className === 'bicycle' ? 4 : 7;
  return [t.x, t.y, t.w, t.h].every(Number.isFinite) && t.w > minimum && t.h > minimum;
}
function compatibility(a: LiveTrack, b: LiveTrack) {
  if (classFamily(a.className) !== classFamily(b.className)) return -1;
  const sizeRatio = Math.max(a.w / b.w, b.w / a.w, a.h / b.h, b.h / a.h);
  if (!Number.isFinite(sizeRatio) || sizeRatio > 2.1) return -1;
  const iou = getIOU(a, b);
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const allowed = Math.max(9, Math.min(a.w + b.w, a.h + b.h) * .34);
  if (iou < .17 && distance > allowed) return -1;
  return iou * 3 - distance / Math.max(10, (a.w + a.h) / 2) - (sizeRatio - 1) * .3;
}

/**
 * Match YOLO's newly detected vehicles to the optically tracked objects
 * already visible on the SAME display frame, never to 1-second-old boxes.
 * Greedy one-to-one matching prevents two nearby cars taking the same ID.
 */
export function reconcileVehicles(
  existing: readonly PersistentTrack[],
  candidates: readonly LiveTrack[],
  mediaTime: number,
  nextId: number,
  knownSourceIds: ReadonlyMap<number, number> = new Map(),
): { tracks: PersistentTrack[]; nextId: number; sourceAssignments: Map<number, number> } {
  const viable = candidates.filter(finiteTrack);
  const options: { previous: number; current: number; score: number }[] = [];
  existing.forEach((old, previous) => {
    viable.forEach((candidate, current) => {
      const score = compatibility(old, candidate);
      if (score > -1) options.push({ previous, current, score });
    });
  });
  options.sort((a, b) => b.score - a.score);
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const assigned: PersistentTrack[] = [];
  const sourceAssignments = new Map<number, number>();
  for (const { previous, current } of options) {
    if (usedOld.has(previous) || usedNew.has(current)) continue;
    const before = existing[previous];
    const after = viable[current];
    usedOld.add(previous);
    usedNew.add(current);
    sourceAssignments.set(after.id, before.id);
    // A gradual correction avoids the huge visual leap when YOLO finally
    // finishes the frame that optical flow has already advanced through.
    const correction = .55;
    const mix = (x: number, y: number) => x + correction * (y - x);
    // Box-size observations are noisier than center positions: suppress
    // abrupt jumps, while still allowing approach/perspective size changes.
    const smoothSize = (oldValue: number, observed: number) => {
      const bounded = Math.max(oldValue * .78, Math.min(oldValue * 1.22, observed));
      return oldValue * .72 + bounded * .28;
    };
    // Keep labels stable, but allow a repeatedly confirmed BUS/TRUCK class
    // to correct an early CAR misclassification.
    const oldVotes = before.classVotes ?? { [before.className]: before.confidence * 2 };
    const votes = Object.fromEntries(Object.entries(oldVotes).map(([key, value]) => [key, value * .84]));
    votes[after.className] = (votes[after.className] ?? 0) + after.confidence;
    if (after.freightEvidence) {
      // Optical and model voting must not undo a strong visible truck-cab
      // correction and leave an obviously freight-bearing vehicle as BUS.
      votes.truck = Math.max(votes.truck ?? 0, (votes.bus ?? 0) + after.confidence * 1.7);
    }
    const label = after.freightEvidence ? 'truck' :
      Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
    assigned.push({
      ...after,
      id: before.id,
      className: label,
      classVotes: votes,
      x: mix(before.x, after.x),
      y: mix(before.y, after.y),
      w: smoothSize(before.w, after.w),
      h: smoothSize(before.h, after.h),
      vx: before.vx,
      vy: before.vy,
      speedKmh: before.speedKmh,
      speedIsEstimate: true,
      lastOpticalAt: mediaTime,
      isPredicted: false,
      lastDetectedAt: mediaTime
    });
  }
  viable.forEach((candidate, index) => {
    if (usedNew.has(index)) return;
    // Avoid duplicated boxes for the same vehicle.
    if (assigned.some(t => classFamily(t.className) === classFamily(candidate.className) &&
      getIOU(t, candidate) > .4)) return;
    // If optical tracking temporarily lost this car, reuse the ID that the
    // persistent detector assigned it earlier rather than creating a new tag.
    const remembered = knownSourceIds.get(candidate.id);
    const inUse = new Set(assigned.map(track => track.id));
    const persistentId = remembered !== undefined && !inUse.has(remembered)
      ? remembered : nextId++;
    sourceAssignments.set(candidate.id, persistentId);
    assigned.push({
      ...candidate,
      id: persistentId,
      speedKmh: null,
      speedIsEstimate: true,
      classVotes: { [candidate.className]: candidate.confidence * 2 },
      lastOpticalAt: mediaTime,
      isPredicted: false,
      lastDetectedAt: mediaTime
    });
  });
  // Keep a missed YOLO track only if optical tracking *still* sees it.
  // Drop it quickly after repeated detector misses or overlap with new boxes.
  existing.forEach((old, index) => {
    if (usedOld.has(index) || mediaTime - old.lastDetectedAt > 1.7 ||
        assigned.some(track => track.id === old.id)) return;
    if (assigned.some(t => classFamily(t.className) === classFamily(old.className) &&
      getIOU(t, old) > .45)) return;
    assigned.push(old);
  });
  return { tracks: assigned, nextId, sourceAssignments };
}

/**
 * Approximate ONLY: no image-only algorithm knows absolute road distances
 * without camera geometry or a trusted reference measurement. Typical vehicle
 * widths provide a rough scale, not certified km/h. Stationary checks use a
 * half-second trajectory and treat subpixel tracking noise as zero.
 */
export function updateScreenSpeed(
  history: SpeedHistory,
  track: LiveTrack,
  mediaTime: number
): { history: SpeedHistory; kmh: number | null } {
  const points = history.points.filter(p => mediaTime - p.time <= 1.2 && p.time <= mediaTime);
  if (!points.length || mediaTime - points[points.length - 1].time > 0.035) {
    points.push({ time: mediaTime, x: track.x, y: track.y + track.h / 2 });
  }
  const minAge = .50;
  const past = points.find(p => mediaTime - p.time >= minAge);
  if (!past) return { history: { points, smoothedKmh: history.smoothedKmh }, kmh: history.smoothedKmh };
  const elapsed = mediaTime - past.time;
  const dx = track.x - past.x;
  const dy = track.y + track.h / 2 - past.y;
  const relativeTravel = Math.hypot(dx, dy) / Math.max(8, track.w);
  // A tenth of the car width in ~0.5 seconds is often matching jitter rather
  // than real motion. Set known stationary cars to exactly zero.
  if (relativeTravel < .07) {
    const next = history.smoothedKmh === null ? 0 : Math.max(0, history.smoothedKmh * .4);
    const kmh = next < 2 ? 0 : next;
    return { history: { points, smoothedKmh: kmh }, kmh };
  }
  const assumedWidth = PHYSICAL_WIDTH_METERS[track.className] ?? 1.82;
  const metersPerPixel = assumedWidth / Math.max(8, track.w);
  // Vertical component is foreshortened in typical elevated roadside footage.
  // This factor is a heuristic only. It MUST be labeled as estimated, not exact.
  const groundPixelPerSecond = Math.hypot(dx, dy * 2.0) / elapsed;
  const estimate = Math.min(160, Math.max(0, 3.6 * metersPerPixel * groundPixelPerSecond));
  const previous = history.smoothedKmh;
  const next = previous === null ? estimate : previous * .75 + estimate * .25;
  return { history: { points, smoothedKmh: next }, kmh: next };
}

/**
 * A single failed optical match is NOT evidence that a vehicle disappeared.
 * Hold a tightly bounded prediction for at most 0.33s while visual matching
 * reacquires. After that, hide it. Never reuse a predicted point for speed.
 */
export function recoverBriefOpticalMisses(
  previous: readonly PersistentTrack[],
  observed: readonly PersistentTrack[],
  previousTime: number,
  mediaTime: number,
  frameWidth: number,
  frameHeight: number,
): PersistentTrack[] {
  const result: PersistentTrack[] = observed.map(track => ({
    ...track, lastOpticalAt: mediaTime, isPredicted: false
  }));
  const present = new Set(result.map(t => t.id));
  const elapsed = mediaTime - previousTime;
  if (!(elapsed > 0 && elapsed <= .25)) return result;
  for (const track of previous) {
    if (present.has(track.id)) continue;
    const sinceReliable = mediaTime - (track.lastOpticalAt ?? track.lastDetectedAt);
    if (sinceReliable < 0 || sinceReliable > .33) continue;
    const velocityLimit = Math.max(110, Math.max(track.w, track.h) * 2.5);
    const rawSpeed = Math.hypot(track.vx, track.vy);
    const scale = rawSpeed > velocityLimit ? velocityLimit / rawSpeed : 1;
    const cx = track.x + track.vx * scale * elapsed;
    const cy = track.y + track.vy * scale * elapsed;
    const left = cx - track.w / 2, top = cy - track.h / 2;
    const right = cx + track.w / 2, bottom = cy + track.h / 2;
    const visibleWidth = Math.max(0, Math.min(frameWidth, right) - Math.max(0, left));
    const visibleHeight = Math.max(0, Math.min(frameHeight, bottom) - Math.max(0, top));
    if (visibleWidth * visibleHeight < track.w * track.h * .35) continue;
    result.push({ ...track, x: cx, y: cy, isPredicted: true });
  }
  return result;
}
