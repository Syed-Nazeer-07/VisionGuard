import type { BoundingBox, TrackedObject } from '../types';
import { Track } from './basetrack';
import { matchDetectionsToTracks } from './matching';

export class ByteTracker {
  public tracks: Track[] = [];
  public trackThreshold: number = 0.5;
  public matchThreshold: number = 0.8;
  public maxTimeLost: number = 30;

  update(detections: BoundingBox[]): TrackedObject[] {
    // 1. Predict new locations
    for (const t of this.tracks) {
      t.predict();
    }

    // 2. Separate detections into high and low confidence
    const highDetections = detections.filter(d => d.prob >= this.trackThreshold);
    const lowDetections = detections.filter(d => d.prob < this.trackThreshold);

    // 3. Separate tracks into active and lost
    const activeTracks = this.tracks.filter(t => t.state === 'Confirmed' || t.state === 'Tentative');
    const lostTracks = this.tracks.filter(t => t.state === 'Lost');

    // 4. First association: Match high conf detections with active tracks
    const firstMatch = matchDetectionsToTracks(highDetections, activeTracks, 0.2); // Low IOU threshold to allow matches
    
    for (const [trackIdx, detIdx] of firstMatch.matches) {
      activeTracks[trackIdx].update(highDetections[detIdx]);
    }

    // 5. Second association: Match remaining unmatched active tracks with low conf detections
    const unmatchedActiveTracks = firstMatch.unmatchedTracks.map(idx => activeTracks[idx]);
    const secondMatch = matchDetectionsToTracks(lowDetections, unmatchedActiveTracks, 0.5); // Stricter threshold

    for (const [trackIdx, detIdx] of secondMatch.matches) {
      unmatchedActiveTracks[trackIdx].update(lowDetections[detIdx]);
    }

    // 6. Handle unmatched tracks (both active and lost)
    const stillUnmatchedTracks = new Set(unmatchedActiveTracks.map((_, i) => i));
    for (const [trackIdx, _] of secondMatch.matches) {
      stillUnmatchedTracks.delete(trackIdx);
    }
    
    for (const idx of Array.from(stillUnmatchedTracks)) {
      unmatchedActiveTracks[idx].markLost();
    }

    for (const t of lostTracks) {
      // Very basic: just let them stay lost until maxTimeLost
      if (t.timeSinceUpdate > this.maxTimeLost) {
        t.state = 'Removed';
      }
    }

    // 7. Create new tracks from unmatched high confidence detections
    for (const idx of firstMatch.unmatchedDetections) {
      this.tracks.push(new Track(highDetections[idx]));
    }

    // Clean up removed tracks
    this.tracks = this.tracks.filter(t => t.state !== 'Removed');

    // Export current tracking results
    return this.tracks
      .filter(t => t.state === 'Confirmed' || (t.state === 'Tentative' && t.age >= 1))
      .map(t => {
        const state = t.kf.getState();
        return {
          x: state.cx,
          y: state.cy,
          w: state.w,
          h: state.h,
          prob: t.prob,
          classId: t.classId,
          className: t.className,
          trackId: t.trackId,
          state: t.state,
          age: t.age
        };
      });
  }

  reset() {
    this.tracks = [];
    Track.nextId = 1;
  }
}
