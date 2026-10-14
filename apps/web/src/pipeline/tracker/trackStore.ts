import type { TrackedObject } from '../types';

export interface StoredTrackRecord {
  track: TrackedObject;
  firstSeenMediaTime: number;
  lastUpdatedMediaTime: number;
  lastUpdatedWallTime: number;
  sourceGeneration: number;
  consecutiveMisses: number;
  timeSinceUpdate: number;
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

    // 1. Ingest fresh incoming tracks
    for (const t of incomingTracks) {
      incomingIds.add(t.trackId);
      const existing = this.tracks.get(t.trackId);

      if (existing) {
        // Update existing track with fresh observation
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
          timeSinceUpdate: t.timeSinceUpdate ?? 0
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

      // If active track has velocity and video is playing, project its position smoothly:
      const t = rec.track;
      let renderedX = t.x;
      let renderedY = t.y;
      let obsType = t.observationType;

      if (!isPaused && mediaAge > 0.02 && (t.dx || t.dy)) {
        // Bounded velocity projection (prevent extrapolation runaway)
        const dt = Math.min(0.40, mediaAge);
        const maxDelta = 120; // max 120 pixels projection
        const deltaX = Math.max(-maxDelta, Math.min(maxDelta, (t.dx ?? 0) * dt));
        const deltaY = Math.max(-maxDelta, Math.min(maxDelta, (t.dy ?? 0) * dt));
        renderedX += deltaX;
        renderedY += deltaY;
        obsType = 'predicted';
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
