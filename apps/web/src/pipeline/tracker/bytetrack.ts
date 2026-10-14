import type { BoundingBox, TrackedObject } from '../types';
import { Track } from './basetrack';
import { matchDetectionsToTracks } from './matching';

export class ByteTracker {
  public tracks: Track[] = [];
  public trackThreshold: number = 0.5;
  /**
   * Minimum IoU for the first (high-confidence) association. ByteTrack's usual match_thresh of 0.8
   * is a cost (1 - IoU), i.e. IoU >= 0.2. A stricter value fragments tracks whenever frames are
   * dropped because vehicles move far between processed frames.
   */
  public matchThreshold: number = 0.2;
  public maxTimeLost: number = 30;

  update(detections: BoundingBox[]): TrackedObject[] {
    // 1. Predict new locations for all current tracks
    for (const t of this.tracks) {
      t.predict();
    }

    // 2. Separate detections into high and low confidence
    const highDetections = detections.filter(d => d.prob >= this.trackThreshold);
    const lowDetections = detections.filter(d => d.prob < this.trackThreshold);

    // 3. Separate tracks into active and lost
    const activeTracks = this.tracks.filter(t => t.state === 'Confirmed' || t.state === 'Tentative');
    const lostTracks = this.tracks.filter(t => t.state === 'Lost');

    // 4. First association: Match high confidence detections with active tracks
    const firstMatch = matchDetectionsToTracks(highDetections, activeTracks, this.matchThreshold);
    
    for (const [trackIdx, detIdx] of firstMatch.matches) {
      activeTracks[trackIdx].update(highDetections[detIdx]);
    }

    // 5. Second association: Match remaining unmatched active tracks with low confidence detections
    const unmatchedActiveTracks = firstMatch.unmatchedTracks.map(idx => activeTracks[idx]);
    const secondMatch = matchDetectionsToTracks(lowDetections, unmatchedActiveTracks, 0.5);

    for (const [trackIdx, detIdx] of secondMatch.matches) {
      unmatchedActiveTracks[trackIdx].update(lowDetections[detIdx]);
    }

    // 6. Handle unmatched active tracks
    const stillUnmatchedActiveIndices = new Set(unmatchedActiveTracks.map((_, i) => i));
    for (const [trackIdx] of secondMatch.matches) {
      stillUnmatchedActiveIndices.delete(trackIdx);
    }
    
    for (const idx of Array.from(stillUnmatchedActiveIndices)) {
      unmatchedActiveTracks[idx].markLost();
    }

    // 7. Third association: Recover lost tracks using remaining unmatched high confidence detections
    const remainingHighDetections = firstMatch.unmatchedDetections.map(idx => highDetections[idx]);
    const thirdMatch = matchDetectionsToTracks(remainingHighDetections, lostTracks, 0.3);

    for (const [lostIdx, detIdx] of thirdMatch.matches) {
      lostTracks[lostIdx].reActivate(remainingHighDetections[detIdx]);
    }

    // Clean up lost tracks that exceeded maxTimeLost
    const recoveredLostIndices = new Set(thirdMatch.matches.map(([lostIdx]) => lostIdx));
    for (let i = 0; i < lostTracks.length; i++) {
      if (!recoveredLostIndices.has(i)) {
        if (lostTracks[i].timeSinceUpdate > this.maxTimeLost) {
          lostTracks[i].markRemoved();
        }
      }
    }

    // 8. Create new tracks from remaining unmatched high confidence detections
    const stillUnmatchedHighIndices = new Set(remainingHighDetections.map((_, i) => i));
    for (const [, detIdx] of thirdMatch.matches) {
      stillUnmatchedHighIndices.delete(detIdx);
    }

    for (const detIdx of Array.from(stillUnmatchedHighIndices)) {
      this.tracks.push(new Track(remainingHighDetections[detIdx]));
    }

    // 9. Clean up removed tracks
    this.tracks = this.tracks.filter(t => t.state !== 'Removed');

    // 10. Export current tracking results
    // Return confirmed tracks (tolerating up to 2 missed inference steps with Kalman prediction) or tentative with timeSinceUpdate === 0
    const out: TrackedObject[] = [];
    for (const t of this.tracks) {
      if (t.state === 'Lost' || t.state === 'Removed') {
        continue;
      }
      // Emit confirmed tracks, or tentative tracks with high confidence (>= 0.60) on first sighting.
      // Low-confidence tentative tracks must achieve hitCount >= 2 before rendering.
      const isValidEmission = (t.state === 'Confirmed') || (t.hitCount >= 2) || (t.prob >= 0.60 && t.timeSinceUpdate === 0);
      if (!isValidEmission) {
        continue;
      }
      if (t.timeSinceUpdate > 2) {
        continue;
      }

      const state = t.kf.getState();
      // For freshly detected frames (timeSinceUpdate === 0), use the exact detected box
      // to prevent any Kalman filter coordinate drift or box displacement.
      const useDetectedBox = t.timeSinceUpdate === 0 && t.lastBox;
      const boxX = useDetectedBox ? t.lastBox.x : state.cx;
      const boxY = useDetectedBox ? t.lastBox.y : state.cy;
      const boxW = useDetectedBox ? t.lastBox.w : state.w;
      const boxH = useDetectedBox ? t.lastBox.h : state.h;

      // Strict geometric validation: discard corrupt or degenerate boxes
      if (!Number.isFinite(boxX) || !Number.isFinite(boxY) || !Number.isFinite(boxW) || !Number.isFinite(boxH)) {
        continue;
      }
      if (boxW < 4 || boxH < 4) {
        continue;
      }

      out.push({
        x: boxX,
        y: boxY,
        w: boxW,
        h: boxH,
        dx: state.dx,
        dy: state.dy,
        dw: state.dw,
        dh: state.dh,
        prob: t.prob,
        classId: t.classId,
        className: t.className,
        trackId: t.trackId,
        state: t.state,
        frameCount: t.frameCount,
        timeSinceUpdate: t.timeSinceUpdate,
        hitCount: t.hitCount,
        observationType: t.timeSinceUpdate > 0 ? 'predicted' : 'detection'
      });
    }

    return out;
  }

  reset() {
    this.tracks = [];
    Track.nextId = 1;
  }
}
