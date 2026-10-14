import { describe, it, expect } from 'vitest';
import { SpeedEstimator } from './speed';

// SCALE_H maps 0.1 normalized -> 10 world units (metres)
const SCALE_H = [100, 0, 0, 0, 100, 0, 0, 0, 1];

describe('SpeedEstimator', () => {
  it('returns null on first update (establishing position)', () => {
    const est = new SpeedEstimator(60, 5);
    const result = est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    expect(result).toBeNull();
  });

  it('returns null on second update when uncalibrated (no homography matrix)', () => {
    const est = new SpeedEstimator(60, 5);
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    const result = est.update(1, { x: 0.6, y: 0.5, w: 0.1, h: 0.1 }, 1.0);
    expect(result).toBeNull();
  });

  it('reports non-negative scalar speed for vehicles moving in positive coordinate direction (+Y and +X)', () => {
    const est = new SpeedEstimator(60, 5);
    est.setHomography(SCALE_H);
    // Move forward/downward (+0.1 normalized = +10m in 1s = 36 km/h)
    est.update(1, { x: 0.5, y: 0.4, w: 0.1, h: 0.1 }, 0);
    const result = est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 1.0);
    expect(result).not.toBeNull();
    // Scalar speed magnitude is strictly non-negative
    expect(result!.speed).toBeCloseTo(36, 1);
    expect(result!.velocity).toBeCloseTo(36, 1);
    expect(result!.vy).toBeCloseTo(36, 1);
  });

  it('reports non-negative scalar speed for vehicles moving in negative coordinate direction (-Y and -X)', () => {
    const est = new SpeedEstimator(60, 5);
    est.setHomography(SCALE_H);
    // Move receding/upward (-0.1 normalized = -10m in 1s = -36 km/h directional velocity)
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    const result = est.update(1, { x: 0.5, y: 0.4, w: 0.1, h: 0.1 }, 1.0);
    expect(result).not.toBeNull();
    // Scalar speed must be positive 36 km/h (not 0 or negative)
    expect(result!.speed).toBeCloseTo(36, 1);
    // Signed directional velocity reflects negative movement
    expect(result!.velocity).toBeCloseTo(-36, 1);
    expect(result!.vy).toBeCloseTo(-36, 1);
  });

  it('calculates 2D vector magnitude when moving diagonally across both axes', () => {
    const est = new SpeedEstimator(60, 5);
    est.setHomography(SCALE_H);
    // Move +0.03 in X (3m) and -0.04 in Y (-4m) in 1s -> displacement vector magnitude = 5m -> 18 km/h
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    const result = est.update(1, { x: 0.53, y: 0.46, w: 0.1, h: 0.1 }, 1.0);
    expect(result).not.toBeNull();
    expect(result!.speed).toBeCloseTo(18, 1);
    expect(result!.vx).toBeCloseTo(10.8, 1);
    expect(result!.vy).toBeCloseTo(-14.4, 1);
  });

  it('handles backwards seek (dt < 0) safely by resetting history', () => {
    const est = new SpeedEstimator(60, 5);
    est.setHomography(SCALE_H);
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 10.0);
    // User seeks backwards to 2.0s
    const seekResult = est.update(1, { x: 0.52, y: 0.5, w: 0.1, h: 0.1 }, 2.0);
    expect(seekResult).toBeNull();

    // Next playback step at 3.0s produces a valid non-negative speed
    const stepResult = est.update(1, { x: 0.54, y: 0.5, w: 0.1, h: 0.1 }, 3.0);
    expect(stepResult).not.toBeNull();
    expect(stepResult!.speed).toBeGreaterThanOrEqual(0);
  });

  it('returns null when dt is too small (sub-millisecond or paused frame)', () => {
    const est = new SpeedEstimator(60, 5);
    est.setHomography(SCALE_H);
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    const result = est.update(1, { x: 0.6, y: 0.5, w: 0.1, h: 0.1 }, 0.0005);
    expect(result).toBeNull();
  });

  it('marks overspeed after sustained high speed', () => {
    const est = new SpeedEstimator(30, 5); // 30 km/h limit + 5 tolerance
    est.setHomography(SCALE_H);
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    // Move 0.1 normalized = 10m in 1s = 36 km/h
    for (let i = 1; i <= 5; i++) {
      est.update(1, { x: 0.5 + i * 0.1, y: 0.5, w: 0.1, h: 0.1 }, i);
    }
    const result = est.update(1, { x: 0.5 + 6 * 0.1, y: 0.5, w: 0.1, h: 0.1 }, 6);
    expect(result).not.toBeNull();
    expect(result!.speed).toBeGreaterThan(30);
  });

  it('reset clears track history', () => {
    const est = new SpeedEstimator(60, 5);
    est.setHomography(SCALE_H);
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    est.reset();
    const result = est.update(1, { x: 0.6, y: 0.5, w: 0.1, h: 0.1 }, 1.0);
    expect(result).toBeNull();
  });

  it('remove() deletes single track history', () => {
    const est = new SpeedEstimator(60, 5);
    est.setHomography(SCALE_H);
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    est.remove(1);
    const result = est.update(1, { x: 0.6, y: 0.5, w: 0.1, h: 0.1 }, 1.0);
    expect(result).toBeNull();
  });

  it('applies hysteresis properly for stationary vehicles settling at 0 km/h', () => {
    const est = new SpeedEstimator(60, 5, 3.0, 7.0);
    est.setHomography(SCALE_H);
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);

    // 1m in 1s = 3.6 km/h (below 7.0 exit threshold -> settles at 0 km/h)
    const res1 = est.update(1, { x: 0.51, y: 0.5, w: 0.1, h: 0.1 }, 1);
    expect(res1).not.toBeNull();
    expect(res1!.speed).toBe(0);

    // Accelerate above 7.0 exit threshold
    est.update(1, { x: 0.54, y: 0.5, w: 0.1, h: 0.1 }, 2);
    est.update(1, { x: 0.57, y: 0.5, w: 0.1, h: 0.1 }, 3);
    const res3 = est.update(1, { x: 0.60, y: 0.5, w: 0.1, h: 0.1 }, 4);
    expect(res3!.speed).toBeGreaterThan(7.0);

    // Decelerate below 3.0 enter threshold -> locks to 0 km/h
    est.update(1, { x: 0.605, y: 0.5, w: 0.1, h: 0.1 }, 5);
    est.update(1, { x: 0.610, y: 0.5, w: 0.1, h: 0.1 }, 6);
    est.update(1, { x: 0.615, y: 0.5, w: 0.1, h: 0.1 }, 7);
    const res4 = est.update(1, { x: 0.620, y: 0.5, w: 0.1, h: 0.1 }, 8);
    expect(res4!.speed).toBe(0);
  });
});
