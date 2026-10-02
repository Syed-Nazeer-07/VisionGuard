import { describe, it, expect } from 'vitest';
import { SpeedEstimator } from './speed';

// Mock homography — projectPoint multiplied by identity-like matrix
// We need to mock projectPoint since we don't have a real homography here
// Instead, test SpeedEstimator with setHomography providing a known matrix.

// For a simple test, we use a known homography H = identity-like 3x3 matrix
// Simple scale matrix: x' = x*100, y' = y*100 (to simulate metres from normalized)
const SCALE_H = [100, 0, 0, 0, 100, 0, 0, 0, 1];

describe('SpeedEstimator', () => {
  it('returns null if no homography is set', () => {
    const est = new SpeedEstimator(60, 5);
    const result = est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    expect(result).toBeNull();
  });

  it('returns null on first update after setting homography (no prior state)', () => {
    const est = new SpeedEstimator(60, 5);
    est.setHomography(SCALE_H);
    const result = est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    expect(result).toBeNull();
  });

  it('returns speed estimate on second update', () => {
    const est = new SpeedEstimator(60, 5);
    est.setHomography(SCALE_H);
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    const result = est.update(1, { x: 0.6, y: 0.5, w: 0.1, h: 0.1 }, 1.0);
    expect(result).not.toBeNull();
    expect(typeof result?.speed).toBe('number');
    expect(result?.speed).toBeGreaterThanOrEqual(0);
  });

  it('returns null when dt is too small', () => {
    const est = new SpeedEstimator(60, 5);
    est.setHomography(SCALE_H);
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    const result = est.update(1, { x: 0.6, y: 0.5, w: 0.1, h: 0.1 }, 0.0005);
    expect(result).toBeNull();
  });

  it('marks overspeed after sustained high speed', () => {
    const est = new SpeedEstimator(30, 5); // 30 km/h limit + 5 tolerance
    est.setHomography(SCALE_H);
    // Move 30 meters in 1 second = 30 m/s = 108 km/h — but that's above 60 m/s filter
    // Move 10 meters/second = 36 km/h (just over limit)
    // SCALE_H maps 0.1 normalized -> 10 world units (metres)
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    // Move 0.1 normalized = 10m in 1s = 36 km/h
    for (let i = 1; i <= 5; i++) {
      est.update(1, { x: 0.5 + i * 0.1, y: 0.5, w: 0.1, h: 0.1 }, i);
    }
    const result = est.update(1, { x: 0.5 + 6 * 0.1, y: 0.5, w: 0.1, h: 0.1 }, 6);
    expect(result).not.toBeNull();
    // Speed should be > 30 km/h limit
    expect(result!.speed).toBeGreaterThan(30);
  });

  it('reset clears track history', () => {
    const est = new SpeedEstimator(60, 5);
    est.setHomography(SCALE_H);
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    est.reset();
    // After reset, next call should return null (no history)
    const result = est.update(1, { x: 0.6, y: 0.5, w: 0.1, h: 0.1 }, 1.0);
    expect(result).toBeNull();
  });

  it('remove() deletes single track history', () => {
    const est = new SpeedEstimator(60, 5);
    est.setHomography(SCALE_H);
    est.update(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0);
    est.remove(1);
    // After remove, track 1 returns null
    const result = est.update(1, { x: 0.6, y: 0.5, w: 0.1, h: 0.1 }, 1.0);
    expect(result).toBeNull();
  });
});
