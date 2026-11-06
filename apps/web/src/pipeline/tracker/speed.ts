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
  private history = new Map<number, {
    lastWorldPt: Point; lastTime: number; speeds: number[];
    overspeedCount: number; isStationary: boolean; lastResult: SpeedResult | null;
    pendingWorldPts: Point[]
  }>();
  // Avoid treating a 1–2 pixel bounding-box wobble between 30 FPS frames
  // as large real-world acceleration. Measure over >= 120ms of video time.
  private readonly minMeasurementIntervalSeconds = 0.12;
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
    // World coordinates from two different road-plane calibrations are NOT
    // comparable. Never carry a vehicle's old km/h, displacement or overspeed
    // streak across a camera/reference change.
    this.reset();
    this.hMatrix = hMatrix && hMatrix.length === 9 && hMatrix.every(Number.isFinite)
      ? [...hMatrix]
      : null;
  }

  update(trackId: number, baseBox: {x: number, y: number, w: number, h: number}, mediaTime: number): SpeedResult | null {
    if (!Number.isFinite(mediaTime) || !Number.isFinite(baseBox.x) || !Number.isFinite(baseBox.y) ||
        !Number.isFinite(baseBox.w) || !Number.isFinite(baseBox.h) ||
        baseBox.w <= 0 || baseBox.h <= 0) return null;
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
    if (!Number.isFinite(worldPt.x) || !Number.isFinite(worldPt.y)) {
      return null; // invalid projective horizon / near-singular mapping
    }

    const state = this.history.get(trackId);

    if (!state) {
      this.history.set(trackId, { lastWorldPt: worldPt, lastTime: mediaTime, speeds: [], overspeedCount: 0, isStationary: true, lastResult: null, pendingWorldPts: [] });
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
      state.lastResult = null;
      state.pendingWorldPts = [];
      return null;
    }

    // Hold the previous *measured* speed during sub-120ms frames instead
    // of deriving implausible km/h from detector bounding-box jitter.
    // No result is emitted until a valid observed displacement is measured.
    if (dt < this.minMeasurementIntervalSeconds) {
      // Accumulate real ground-contact observations instead of repeatedly
      // updating the speed baseline from a single noisy frame.
      state.pendingWorldPts.push(worldPt);
      if (state.pendingWorldPts.length > 4) state.pendingWorldPts.shift();
      return state.lastResult;
    }

    // Median of the final short observation window resists ±pixel jitter
    // without flattening sustained motion over the measurement interval.
    // A single observation (slow inference) still uses its exact coordinate.
    const samples = [...state.pendingWorldPts.slice(-2), worldPt];
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const robustWorldPt = {
      x: median(samples.map(p => p.x)),
      y: median(samples.map(p => p.y))
    };
    state.pendingWorldPts = [];

    const dx = robustWorldPt.x - state.lastWorldPt.x;
    const dy = robustWorldPt.y - state.lastWorldPt.y;

    // Velocity components in m/s
    const vxMps = dx / dt;
    const vyMps = dy / dt;

    // Vector magnitude of velocity in m/s: sqrt(vx^2 + vy^2)
    const speedMagnitudeMps = Math.hypot(vxMps, vyMps);

    // Limit extreme jumps (e.g. > 60 m/s = 216 km/h)
    if (!Number.isFinite(speedMagnitudeMps) || speedMagnitudeMps > 60) {
      // Teleportation usually means an ID switch or an invalid ground point.
      // Establish a new baseline but NEVER keep the prior speed/overspeed
      // result alive on the next frame.
      state.lastWorldPt = worldPt;
      state.lastTime = mediaTime;
      state.pendingWorldPts = [];
      state.speeds = [];
      state.isStationary = true;
      state.overspeedCount = 0;
      state.lastResult = null;
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

    state.lastWorldPt = robustWorldPt;
    state.lastTime = mediaTime;

    state.lastResult = {
      speed: medianSpeed,
      velocity: directionalVelocityKmh,
      vx: vxKmh,
      vy: vyKmh,
      isOverspeed: state.overspeedCount >= 3,
      isEstimated: true
    };
    return state.lastResult;
  }

  remove(trackId: number) {
    this.history.delete(trackId);
  }

  reset() {
    this.history.clear();
  }
}
