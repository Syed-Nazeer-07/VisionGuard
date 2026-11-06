import type { TrackedObject } from '../types';

export interface StoredTrackRecord {
  track: TrackedObject;
  firstSeenMediaTime: number;
  lastUpdatedMediaTime: number;
  lastUpdatedWallTime: number;
  sourceGeneration: number;
  consecutiveMisses: number;
  timeSinceUpdate: number;
  /** Last display position and observed velocity in source pixels per second. */
  displayX: number;
  displayY: number;
  observedVx: number;
  observedVy: number;
}

/**
 * Persistent, source-specific track-state store.
 * Decouples inference scheduling from continuous video overlay presentation.
 * Preserves active tracks through inference delays, projects motion smoothly at 60 FPS,
 * and strictly expires lost tracks after bounded retention.
 */
export class TrackStateStore {
  private tracks: Map<number, StoredTrackRecord> = new Map();
  private currentGeneration: number = 0;
  private lastInferenceMediaTime: number = 0;

  // Maximum time to hold an active track during continuous playback without an update (in media seconds)
  public maxActiveRetentionMediaSec: number = 0.85;
  // Maximum consecutive inference misses before removing an unconfirmed or lost track
  public maxConsecutiveMisses: number = 5;

  /**
   * Set or reset the current source generation.
   * When switching video sources or starting a new run, all prior tracks are wiped cleanly.
   */
  setGeneration(generation: number): void {
    if (this.currentGeneration !== generation) {
      this.tracks.clear();
      this.currentGeneration = generation;
      this.lastInferenceMediaTime = 0;
    }
  }

  getGeneration(): number {
    return this.currentGeneration;
  }

  /**
   * Clear all tracks (e.g. on source unload, seek, or engine switch).
   */
  clear(): void {
    this.tracks.clear();
    this.lastInferenceMediaTime = 0;
  }

  get size(): number {
    return this.tracks.size;
  }

  /**
   * Update store with fresh inference results from worker or backend.
   * Does NOT replace valid active state with an empty array if msg.tracks is empty!
   */
  updateFromInference(
    incomingTracks: TrackedObject[],
    mediaTime: number,
    sourceGeneration: number,
    nowWall: number = performance.now()
  ): void {
    if (sourceGeneration !== this.currentGeneration) {
      return; // Discard results from previous video / old generation
    }

    this.lastInferenceMediaTime = mediaTime;
    const incomingIds = new Set<number>();

    // 1. Ingest only genuine detector measurements. Some tracker/backends
    // send interpolated/predicted boxes on frames with no detector match.
    // Those must NOT reset the freshness clock, update display velocity,
    // or create a new visible track: doing so produces boxes that drift
    // across the road and survive after their actual vehicle disappeared.
    for (const t of incomingTracks) {
      const isObserved = (t.observationType === undefined || t.observationType === 'detection')
        && (t.timeSinceUpdate ?? 0) === 0;
      if (!isObserved) continue;

      incomingIds.add(t.trackId);
      const existing = this.tracks.get(t.trackId);

      if (existing) {
        // Estimate movement from actual consecutive detector coordinates,
        // not Kalman velocity in "pixels per inference step". Video frames
        // may arrive at 5–60 FPS while the model runs at a different cadence.
        const dt = mediaTime - existing.lastUpdatedMediaTime;
        const maxMove = Math.max(t.w, t.h, existing.track.w, existing.track.h) * 2;
        const move = Math.hypot(t.x - existing.track.x, t.y - existing.track.y);
        const continuous = dt >= 0.025 && dt <= 0.8 && move <= maxMove;
        if (continuous) {
          const measuredVx = (t.x - existing.track.x) / dt;
          const measuredVy = (t.y - existing.track.y) / dt;
          existing.observedVx = 0.35 * existing.observedVx + 0.65 * measuredVx;
          existing.observedVy = 0.35 * existing.observedVy + 0.65 * measuredVy;
          // Short correction smoothing avoids one-frame jumps; do not
          // replace the underlying raw observation used for future velocity.
          existing.displayX += 0.78 * (t.x - existing.displayX);
          existing.displayY += 0.78 * (t.y - existing.displayY);
        } else {
          // Reacquisition or implausible jump: snap to the actual detection
          // and reset velocity so stale predictions cannot drift across lanes.
          existing.displayX = t.x;
          existing.displayY = t.y;
          existing.observedVx = 0;
          existing.observedVy = 0;
        }
        existing.track = { ...t };
        existing.lastUpdatedMediaTime = mediaTime;
        existing.lastUpdatedWallTime = nowWall;
        existing.consecutiveMisses = 0;
        existing.timeSinceUpdate = t.timeSinceUpdate ?? 0;
      } else {
        // Insert new track
        this.tracks.set(t.trackId, {
          track: { ...t },
          firstSeenMediaTime: mediaTime,
          lastUpdatedMediaTime: mediaTime,
          lastUpdatedWallTime: nowWall,
          sourceGeneration,
          consecutiveMisses: 0,
          timeSinceUpdate: t.timeSinceUpdate ?? 0,
          displayX: t.x,
          displayY: t.y,
          observedVx: 0,
          observedVy: 0
        });
      }
    }

    // 2. Age tracks that were NOT seen in this inference frame
    for (const [id, rec] of this.tracks.entries()) {
      if (!incomingIds.has(id)) {
        rec.consecutiveMisses++;
        rec.timeSinceUpdate++;

        // Stricter expiration for tentative or lost tracks:
        const isTentative = rec.track.state === 'Tentative';
        const isLost = rec.track.state === 'Lost' || rec.track.state === 'Removed';
        const maxMisses = isTentative ? 2 : isLost ? 2 : this.maxConsecutiveMisses;
        const mediaDelta = Math.abs(mediaTime - rec.lastUpdatedMediaTime);

        if (rec.consecutiveMisses > maxMisses || mediaDelta > this.maxActiveRetentionMediaSec) {
          this.tracks.delete(id);
        }
      }
    }
  }

  /**
   * Query tracks to render on the video frame at `currentMediaTime`.
   * Projects motion along velocity vector during inference gaps so boxes follow vehicles smoothly at 60fps!
   */
  getTracksToRender(
    currentMediaTime: number,
    isPaused: boolean,
    nowWall: number = performance.now()
  ): TrackedObject[] {
    const results: TrackedObject[] = [];
    const idsToDelete: number[] = [];

    for (const [id, rec] of this.tracks.entries()) {
      if (rec.sourceGeneration !== this.currentGeneration) {
        idsToDelete.push(id);
        continue;
      }

      const mediaAge = currentMediaTime - rec.lastUpdatedMediaTime;
      const wallAgeMs = nowWall - rec.lastUpdatedWallTime;

      // Handle seeking/reverse: if media time jumped backwards past last update by > 0.5s:
      if (mediaAge < -0.5) {
        idsToDelete.push(id);
        continue;
      }

      // Check freshness budget:
      // While paused, accept tracks up to 0.50s around the paused point
      // While playing, accept up to maxActiveRetentionMediaSec (0.85s) or wall-clock 1800ms
      const isFresh = isPaused
        ? Math.abs(mediaAge) <= 0.50
        : (mediaAge >= -0.10 && mediaAge <= this.maxActiveRetentionMediaSec && wallAgeMs <= 1800);

      if (!isFresh) {
        if (mediaAge > this.maxActiveRetentionMediaSec || wallAgeMs > 1800) {
          idsToDelete.push(id);
        }
        continue;
      }

      // Project a short distance using measured observations, not a Kalman
      // state whose velocity is denominated in inference frames. Prediction
      // is capped by the size of the tracked object and time since observation.
      const t = rec.track;
      let renderedX = rec.displayX;
      let renderedY = rec.displayY;
      let obsType = t.observationType;

      if (!isPaused && mediaAge > 0.02 && mediaAge <= 0.30) {
        const dt = Math.min(0.22, mediaAge);
        const maxDelta = Math.max(t.w, t.h) * 0.45;
        renderedX += Math.max(-maxDelta, Math.min(maxDelta, rec.observedVx * dt));
        renderedY += Math.max(-maxDelta, Math.min(maxDelta, rec.observedVy * dt));
        if (rec.observedVx !== 0 || rec.observedVy !== 0) obsType = 'predicted';
      }

      results.push({
        ...t,
        x: renderedX,
        y: renderedY,
        timeSinceUpdate: rec.consecutiveMisses > 0 ? 1 : 0,
        observationType: obsType
      });
    }

    for (const id of idsToDelete) {
      this.tracks.delete(id);
    }

    return results;
  }
}
