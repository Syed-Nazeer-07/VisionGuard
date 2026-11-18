import { describe, expect, it } from 'vitest';
import {
  INITIAL_SYNC_PLAYBACK_RATE, MIN_SYNC_PLAYBACK_RATE,
  recommendedSyncPlaybackRate, shouldHoldRecordedPlayback, shouldLockRecordedInference,
} from './syncedPlayback';

describe('recorded-video detector-synchronized playback', () => {
  it('slows playback when one detector inference takes about two seconds', () => {
    const rate = recommendedSyncPlaybackRate(1800, INITIAL_SYNC_PLAYBACK_RATE);
    expect(rate).toBeGreaterThanOrEqual(MIN_SYNC_PLAYBACK_RATE);
    expect(rate).toBeLessThan(0.2);
  });

  it('recovers toward 1x on faster hardware without exceeding native speed', () => {
    let rate = INITIAL_SYNC_PLAYBACK_RATE;
    for (let i = 0; i < 15; i++) rate = recommendedSyncPlaybackRate(60, rate);
    expect(rate).toBe(1);
  });

  it('smooths a single high-latency spike rather than abruptly changing speed', () => {
    expect(recommendedSyncPlaybackRate(1600, 0.7)).toBeGreaterThan(0.1);
    expect(recommendedSyncPlaybackRate(1600, 0.7)).toBeLessThan(0.7);
  });

  it('holds recorded sync playback until the detector is ready', () => {
    expect(shouldHoldRecordedPlayback(true, false, false)).toBe(true);
    expect(shouldHoldRecordedPlayback(false, false, false)).toBe(false);
    expect(shouldHoldRecordedPlayback(true, true, false)).toBe(false);
    expect(shouldHoldRecordedPlayback(true, false, true)).toBe(false);
  });

  it('locks only active recorded-video inference, never live capture or frame inspection', () => {
    expect(shouldLockRecordedInference(true, false, false, false)).toBe(true);
    expect(shouldLockRecordedInference(false, false, false, false)).toBe(false);
    expect(shouldLockRecordedInference(true, true, false, false)).toBe(false);
    expect(shouldLockRecordedInference(true, false, true, false)).toBe(false);
    expect(shouldLockRecordedInference(true, false, false, true)).toBe(false);
  });

  it('uses a safe bounded rate when timing is invalid', () => {
    expect(recommendedSyncPlaybackRate(Number.NaN, 0.2)).toBe(0.2);
    expect(recommendedSyncPlaybackRate(-1, Number.NaN)).toBe(INITIAL_SYNC_PLAYBACK_RATE);
    expect(recommendedSyncPlaybackRate(1e9, 0.1)).toBe(MIN_SYNC_PLAYBACK_RATE);
  });
});
