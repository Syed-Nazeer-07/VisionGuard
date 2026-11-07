/** Conservative automatic review candidates, not verified traffic offences. */
export interface IncidentObservation {
  id: number; className: string; confidence: number;
  x: number; y: number; w: number; h: number;
  speedKmh: number | null; isPredicted?: boolean;
}
export interface AutomaticReviewCandidate {
  trackId: number;
  type: 'speed_estimate_review' | 'stationary_vehicle_review';
  evidenceNote: string;
}
type Streak = {
  since: number; count: number; peak: number; x: number; y: number;
  movingPeers: Set<number>; simultaneousTrafficFrames: number;
};
type State = {
  lastSeen: number; lastSample: number;
  speed: Streak | null; stopped: Streak | null;
  speedFlagged: boolean; stoppedFlagged: boolean;
};
const REVIEW_SPEED_KMH = 80;
const SAMPLE_INTERVAL = 0.18;
const STREAK_GAP = 0.6;
function valid(t: IncidentObservation): boolean {
  return Number.isSafeInteger(t.id) && t.id > 0 && t.confidence >= 0.68 &&
    Number.isFinite(t.confidence) && !t.isPredicted &&
    t.speedKmh !== null && Number.isFinite(t.speedKmh) &&
    t.speedKmh >= 0 && t.speedKmh <= 160 && t.w >= 8 && t.h >= 8 &&
    [t.x, t.y, t.w, t.h].every(Number.isFinite);
}
function streak(t: IncidentObservation, time: number): Streak {
  return { since: time, count: 1, peak: t.speedKmh ?? 0,
    x: t.x, y: t.y, movingPeers: new Set<number>(), simultaneousTrafficFrames: 0 };
}
/** Call once per optical sample; reset when seeking or changing sources. */
export class AutomaticIncidentDetector {
  private readonly states = new Map<number, State>();
  private lastTime: number | null = null;
  reset() { this.states.clear(); this.lastTime = null; }
  ingest(tracks: readonly IncidentObservation[], time: number): AutomaticReviewCandidate[] {
    if (!Number.isFinite(time) || time < 0) return [];
    if (this.lastTime !== null && (time < this.lastTime - .01 || time - this.lastTime > 1.5))
      this.reset();
    this.lastTime = time;
    const reliable = tracks.filter(valid);
    const movingIds = reliable.filter(t => t.speedKmh! >= 12).map(t => t.id);
    const candidates: AutomaticReviewCandidate[] = [];
    for (const t of reliable) {
      let state = this.states.get(t.id);
      if (!state) {
        state = { lastSeen: time, lastSample: -Infinity, speed: null, stopped: null,
          speedFlagged: false, stoppedFlagged: false };
        this.states.set(t.id, state);
      }
      const elapsed = time - state.lastSample;
      state.lastSeen = time;
      if (elapsed < SAMPLE_INTERVAL) continue;
      state.lastSample = time;
      const speed = t.speedKmh!;
      if (speed >= REVIEW_SPEED_KMH) {
        if (!state.speed || elapsed > STREAK_GAP) state.speed = streak(t, time);
        else { state.speed.count++; state.speed.peak = Math.max(state.speed.peak, speed); }
        const s = state.speed;
        // Uncalibrated speed readings can stay high while the tracked box
        // itself is immobile. Require actual image-space displacement over
        // the same streak, not just a stale smoothed km/h value.
        const imageTravel = Math.hypot(t.x - s.x, t.y - s.y);
        const minimumTravel = Math.max(8, t.w * .28);
        if (!state.speedFlagged && s.count >= 5 && time - s.since >= .9 &&
            imageTravel >= minimumTravel) {
          state.speedFlagged = true;
          candidates.push({ trackId: t.id, type: 'speed_estimate_review',
            evidenceNote: 'Automatically observed at least ' + s.count +
              ' consecutive uncalibrated optical estimates above ≈80 km/h over ' +
              (time - s.since).toFixed(1) + 's (peak ≈' + Math.round(s.peak) +
              ' km/h; visible travel ≈' + Math.round(imageTravel) +
              ' pixels). Road speed and limit are unknown. NOT verified speeding.' });
        }
      } else state.speed = null;

      const roadVehicle = ['car','bus','truck','bus/truck','motorcycle'].includes(t.className);
      if (roadVehicle && speed <= 3) {
        const old = state.stopped;
        const drift = old ? Math.hypot(t.x - old.x, t.y - old.y) : 0;
        const tolerance = Math.max(6, Math.min(t.w, t.h) * .22);
        if (!old || elapsed > STREAK_GAP || drift > tolerance) state.stopped = streak(t, time);
        else state.stopped!.count++;
        const movingPeers = movingIds.filter(id => id !== t.id);
        for (const id of movingPeers) state.stopped!.movingPeers.add(id);
        // One car now and one car much later do not establish surrounding
        // moving traffic. Require repeated, simultaneous moving peers.
        if (movingPeers.length >= 2) state.stopped!.simultaneousTrafficFrames++;
        const s = state.stopped!;
        if (!state.stoppedFlagged && s.count >= 20 && time - s.since >= 10 &&
            s.movingPeers.size >= 2 && s.simultaneousTrafficFrames >= 6) {
          state.stoppedFlagged = true;
          candidates.push({ trackId: t.id, type: 'stationary_vehicle_review',
            evidenceNote: 'Automatically observed a stationary vehicle for ' +
              (time - s.since).toFixed(1) + 's while ' + s.movingPeers.size +
              ' other vehicles moved. Could be normal traffic, parking or a stoplight. ' +
              'Neither a collision nor an obstruction is confirmed; human review needed.' });
        }
      } else state.stopped = null;
    }
    // Never continue a streak from a vehicle that has vanished.
    for (const [id, s] of this.states) if (time - s.lastSeen > STREAK_GAP) this.states.delete(id);
    return candidates;
  }
}
