import { describe, expect, it } from 'vitest';
import { analysisPaintIntervalMs, shouldPaintAnalysisFrame } from './frameBudget';

describe('live overlay paint policy', () => {
  it('caps touch-phone overlays at 30 FPS', () => {
    expect(analysisPaintIntervalMs(390, true)).toBeCloseTo(33.333, 2);
    expect(analysisPaintIntervalMs(767, true)).toBeCloseTo(33.333, 2);
  });
  it('preserves 60 FPS targets for laptops, monitors and tablets', () => {
    expect(analysisPaintIntervalMs(1440, false)).toBeCloseTo(16.667, 2);
    expect(analysisPaintIntervalMs(2560, false)).toBeCloseTo(16.667, 2);
    expect(analysisPaintIntervalMs(820, true)).toBeCloseTo(16.667, 2);
  });
  it('skips redundant phone-frame paints without affecting video playback', () => {
    const interval = analysisPaintIntervalMs(390, true);
    expect(shouldPaintAnalysisFrame(100, 0, interval)).toBe(true);
    expect(shouldPaintAnalysisFrame(116.7, 100, interval)).toBe(false);
    expect(shouldPaintAnalysisFrame(133.4, 100, interval)).toBe(true);
  });
  it('recovers immediately after timestamp reset and ignores invalid time', () => {
    expect(shouldPaintAnalysisFrame(100, 200, 33.3)).toBe(true);
    expect(shouldPaintAnalysisFrame(Number.NaN, 200, 33.3)).toBe(false);
  });
});
