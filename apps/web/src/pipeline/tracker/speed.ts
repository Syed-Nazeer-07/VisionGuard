import type { Point } from '../types';
import { projectPoint } from './homography';

export interface SpeedResult {
  speed: number; // Strictly non-negative scalar speed magnitude in km/h
  velocity?: number; // Signed directional velocity in km/h (positive = forward/downward, negative = receding/upward)
  vx?: number; // Velocity component along X in km/h
  vy?: number; // Velocity component along Y in km/h
  isOverspeed: boolean;
  isEstimated: boolean;
}

export class SpeedEstimator {
  private history = new Map<number, { lastWorldPt: Point, lastTime: number, speeds: number[], overspeedCount: number, isStationary: boolean }>();
  private speedLimit: number;
  private tolerance: number;
  private hMatrix: number[] | null = null;
  private windowSize = 5;
  
  // Hysteresis thresholds for stationary vehicles to avoid speed jitter.
  // Vehicles moving slower than stationaryEnterThreshold will lock to 0 km/h.
  // They must exceed stationaryExitThreshold to break out of stationary state.
  private stationaryEnterThreshold: number;
  private stationaryExitThreshold: number;

  constructor(speedLimit: number, tolerance: number, stationaryEnterThreshold = 3.0, stationaryExitThreshold = 7.0) {
    this.speedLimit = speedLimit;
    this.tolerance = tolerance;
    this.stationaryEnterThreshold = stationaryEnterThreshold;
    this.stationaryExitThreshold = stationaryExitThreshold;
  }

  setHomography(hMatrix: number[] | null) {
    this.hMatrix = hMatrix;
  }

  update(trackId: number, baseBox: {x: number, y: number, w: number, h: number}, mediaTime: number): SpeedResult | null {
    if (!this.hMatrix || this.hMatrix.length !== 9) {
      // Without ground-plane calibration homography, physical speed cannot be calculated.
      // Never fabricate speed or convert raw pixel displacement directly into km/h.
      return null;
    }

    // baseBox.x and baseBox.y are the CENTER coordinates of the bounding box.
    // To find the bottom-center (where the vehicle touches the road plane),
    // we take the center X and add half the height to the center Y.
    const imagePt: Point = {
      x: baseBox.x,
      y: baseBox.y + baseBox.h / 2
    };

    let worldPt: Point;
    try {
      worldPt = projectPoint(this.hMatrix, imagePt);
    } catch {
      return null;
    }

    const state = this.history.get(trackId);

    if (!state) {
      this.history.set(trackId, { lastWorldPt: worldPt, lastTime: mediaTime, speeds: [], overspeedCount: 0, isStationary: true });
      return null;
    }

    const dt = mediaTime - state.lastTime;

    // Discontinuity or backwards seek: reset tracking history for this vehicle
    if (dt < 0 || dt > 2.0) {
      state.lastWorldPt = worldPt;
      state.lastTime = mediaTime;
      state.speeds = [];
      state.isStationary = true;
      state.overspeedCount = 0;
      return null;
    }

    // Identical frame or negligible advance
    if (dt <= 0.001) return null;

    const dx = worldPt.x - state.lastWorldPt.x;
    const dy = worldPt.y - state.lastWorldPt.y;

    // Velocity components in m/s
    const vxMps = dx / dt;
    const vyMps = dy / dt;

    // Vector magnitude of velocity in m/s: sqrt(vx^2 + vy^2)
    const speedMagnitudeMps = Math.hypot(vxMps, vyMps);

    // Limit extreme jumps (e.g. > 60 m/s = 216 km/h)
    if (speedMagnitudeMps > 60) {
      state.lastWorldPt = worldPt;
      state.lastTime = mediaTime;
      return null;
    }

    // Velocity components in km/h
    const vxKmh = vxMps * 3.6;
    const vyKmh = vyMps * 3.6;

    // Scalar speed magnitude is derived from vector magnitude (always non-negative)
    // For 1D single-axis motion along Y, Math.hypot(0, vy) equals Math.abs(vy).
    const rawScalarSpeedKmh = Math.hypot(vxKmh, vyKmh);

    // Signed directional velocity along primary traffic axis (Y) kept separate for flow analysis
    const directionalVelocityKmh = vyKmh;

    state.speeds.push(rawScalarSpeedKmh);
    if (state.speeds.length > this.windowSize) {
      state.speeds.shift();
    }

    const sorted = [...state.speeds].sort((a, b) => a - b);
    let medianSpeed = sorted[Math.floor(sorted.length / 2)];

    // Stationary deadband with hysteresis
    if (state.isStationary) {
      if (medianSpeed > this.stationaryExitThreshold) {
        state.isStationary = false;
      } else {
        medianSpeed = 0;
      }
    } else {
      if (medianSpeed < this.stationaryEnterThreshold) {
        state.isStationary = true;
        medianSpeed = 0;
      }
    }

    if (medianSpeed > this.speedLimit + this.tolerance) {
      state.overspeedCount++;
    } else {
      state.overspeedCount = 0;
    }

    state.lastWorldPt = worldPt;
    state.lastTime = mediaTime;

    return {
      speed: medianSpeed,
      velocity: directionalVelocityKmh,
      vx: vxKmh,
      vy: vyKmh,
      isOverspeed: state.overspeedCount >= 3,
      isEstimated: true
    };
  }

  remove(trackId: number) {
    this.history.delete(trackId);
  }

  reset() {
    this.history.clear();
  }
}
