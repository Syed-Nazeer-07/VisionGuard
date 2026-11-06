import { describe, expect, it } from 'vitest';
import { estimateVideoFrameRate, recommendedPlaybackRate } from './syncedPlayback';

describe('frame-aligned browser video playback', () => {
  it('keeps normal playback when the detector is fast enough', () => {
    expect(recommendedPlaybackRate(12, 30)).toBe(1);
  });
  it('slows videos that outpace inference instead of showing stale boxes', () => {
    const rate = recommendedPlaybackRate(180, 30);
    expect(rate).toBeGreaterThanOrEqual(.2);
    expect(rate).toBeLessThan(.3);
  });
  it('bounds extremely slow devices and handles invalid timings safely', () => {
    expect(recommendedPlaybackRate(1500, 30)).toBe(.2);
    expect(recommendedPlaybackRate(NaN, 30)).toBe(1);
    expect(recommendedPlaybackRate(80, 0)).toBe(1);
  });
  it('observes the actual source frame rate from presented frame timestamps', () => {
    expect(estimateVideoFrameRate(30, 2, 1 / 30)).toBeCloseTo(36, 5);
    expect(estimateVideoFrameRate(30, 1, 0)).toBe(30);
    expect(estimateVideoFrameRate(30, 1, 10)).toBe(30);
  });
});
