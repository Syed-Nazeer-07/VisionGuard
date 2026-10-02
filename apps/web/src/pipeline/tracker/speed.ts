import type { Point } from '../types';
import { projectPoint } from './homography';

export class SpeedEstimator {
  private history = new Map<number, { lastWorldPt: Point, lastTime: number, speeds: number[], overspeedCount: number }>();
  private speedLimit: number;
  private tolerance: number;
  private hMatrix: number[] | null = null;
  private windowSize = 5;

  constructor(speedLimit: number, tolerance: number) {
    this.speedLimit = speedLimit;
    this.tolerance = tolerance;
  }

  setHomography(hMatrix: number[] | null) {
    this.hMatrix = hMatrix;
  }

  update(trackId: number, baseBox: {x: number, y: number, w: number, h: number}, mediaTime: number): { speed: number, isOverspeed: boolean } | null {
    if (!this.hMatrix) return null;

    // Use bottom center of the bounding box for ground plane projection
    const imagePt: Point = {
      x: baseBox.x,
      y: baseBox.y + baseBox.h / 2
    };

    const worldPt = projectPoint(this.hMatrix, imagePt);
    const state = this.history.get(trackId);

    if (!state) {
      this.history.set(trackId, { lastWorldPt: worldPt, lastTime: mediaTime, speeds: [], overspeedCount: 0 });
      return null;
    }

    const dt = mediaTime - state.lastTime;
    if (dt <= 0.001) return null; // Avoid division by zero or extremely tiny steps

    const dx = worldPt.x - state.lastWorldPt.x;
    const dy = worldPt.y - state.lastWorldPt.y;
    const distMeters = Math.hypot(dx, dy);

    // Filter out huge jumps that might be tracker errors (e.g., > 200 km/h = ~55 m/s)
    const rawSpeedMps = distMeters / dt;
    if (rawSpeedMps > 60) {
      // Just update time and pt, don't use this jump
      state.lastWorldPt = worldPt;
      state.lastTime = mediaTime;
      return null;
    }

    const rawSpeedKmh = rawSpeedMps * 3.6;
    state.speeds.push(rawSpeedKmh);
    if (state.speeds.length > this.windowSize) {
      state.speeds.shift();
    }

    // Median smoothing
    const sorted = [...state.speeds].sort((a, b) => a - b);
    const medianSpeed = sorted[Math.floor(sorted.length / 2)];

    if (medianSpeed > this.speedLimit + this.tolerance) {
      state.overspeedCount++;
    } else {
      state.overspeedCount = 0;
    }

    state.lastWorldPt = worldPt;
    state.lastTime = mediaTime;

    return {
      speed: medianSpeed,
      isOverspeed: state.overspeedCount >= 3
    };
  }

  remove(trackId: number) {
    this.history.delete(trackId);
  }

  reset() {
    this.history.clear();
  }
}
