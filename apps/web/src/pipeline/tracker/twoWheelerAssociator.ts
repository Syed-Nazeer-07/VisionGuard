import type { BoundingBox } from '../types';
import type { LiveTrack } from './liveProjection';

/**
 * Two-wheelers have much smaller boxes and lower YOLO scores than cars.
 * ByteTracker's default high-confidence new-track gate drops them, even
 * after the detector finds them. Keep a separate, conservative association
 * layer without altering existing car/bus/truck tracking.
 */
export class TwoWheelerAssociator {
  private nextId = -1;
  private observations: Array<{
    id: number;
    box: BoundingBox;
    seenAt: number;
    sightings: number;
  }> = [];

  reset() {
    this.observations = [];
    this.nextId = -1;
  }

  update(allBoxes: readonly BoundingBox[], mediaTime: number): LiveTrack[] {
    const candidates = allBoxes.filter(box => box.classId === 1 || box.classId === 3);
    this.observations = this.observations.filter(o => mediaTime - o.seenAt <= 2.3);
    const matched = new Set<number>();
    const results: LiveTrack[] = [];

    for (const box of candidates.sort((a, b) => b.prob - a.prob)) {
      let bestIndex = -1;
      let bestScore = Infinity;
      for (let i = 0; i < this.observations.length; i++) {
        if (matched.has(i)) continue;
        const observation = this.observations[i];
        if (observation.box.classId !== box.classId) continue;
        const dt = mediaTime - observation.seenAt;
        if (dt < 0 || dt > 2.3) continue;
        const distance = Math.hypot(box.x - observation.box.x, box.y - observation.box.y);
        const radius = Math.max(26, Math.max(box.w, box.h) * 2.5 + dt * 72);
        const ratio = Math.max(box.w / observation.box.w, observation.box.w / box.w,
          box.h / observation.box.h, observation.box.h / box.h);
        if (ratio > 2.5 || distance > radius) continue;
        const normalized = distance / radius + (ratio - 1) * .3;
        if (normalized < bestScore) {
          bestScore = normalized;
          bestIndex = i;
        }
      }

      const observation = bestIndex >= 0 ? this.observations[bestIndex] : {
        id: this.nextId--, box, seenAt: mediaTime, sightings: 0
      };
      if (bestIndex < 0) {
        this.observations.push(observation);
        bestIndex = this.observations.length - 1;
      }
      const delta = mediaTime - observation.seenAt;
      const vx = delta > .04 && delta < 2.3 ? (box.x - observation.box.x) / delta : 0;
      const vy = delta > .04 && delta < 2.3 ? (box.y - observation.box.y) / delta : 0;
      observation.box = box;
      observation.seenAt = mediaTime;
      observation.sightings++;
      matched.add(bestIndex);

      // A good first motorcycle detection is displayed immediately. Weaker
      // detections need two sightings so pedestrians are not boxed as bikes.
      const strong = box.prob >= (box.classId === 3 ? .36 : .41);
      if (!strong && observation.sightings < 2) continue;
      results.push({
        id: observation.id,
        className: box.className,
        confidence: box.prob,
        x: box.x, y: box.y, w: box.w, h: box.h,
        vx, vy, motionPxPerSec: Math.hypot(vx, vy)
      });
    }
    return results;
  }
}
