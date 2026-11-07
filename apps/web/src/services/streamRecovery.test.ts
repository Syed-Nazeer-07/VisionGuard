import { describe, expect, it } from 'vitest';
import { hasAdvancedVideoFrame, isStreamStalled, liveRetryDelay, shouldPaintLiveOverlay, LIVE_OVERLAY_FRESHNESS_MS } from './streamRecovery';

const playing = { paused: false, ended: false, seeking: false };

describe('live video stall detection', () => {
  it('does not declare an active stream frozen before the threshold', () => {
    expect(isStreamStalled(13_000, 1_000, playing)).toBe(false);
  });
  it('detects a genuinely stalled stream after its last decoded frame', () => {
    expect(isStreamStalled(17_100, 1_000, playing)).toBe(true);
  });
  it('never reconnects because a user paused, sought or finished a video', () => {
    for (const key of ['paused','ended','seeking'] as const) {
      expect(isStreamStalled(20_000, 1_000, { ...playing, [key]: true })).toBe(false);
    }
  });
  it('does not use an uninitialized frame clock as evidence of a stall', () => {
    expect(isStreamStalled(30_000, 0, playing)).toBe(false);
  });
  it('bounds retry delay to prevent runaway reconnection frequency', () => {
    expect(liveRetryDelay(1)).toBe(1_500);
    expect(liveRetryDelay(3)).toBe(4_500);
    expect(liveRetryDelay(50)).toBe(7_500);
  });
});

describe('video progress signal for live feeds', () => {
  it('recognizes the first decoded frame and advancing timestamps', () => {
    expect(hasAdvancedVideoFrame(null, 0)).toBe(true);
    expect(hasAdvancedVideoFrame(4.2, 4.24)).toBe(true);
  });
  it('rejects frozen, reversed and invalid media timestamps', () => {
    expect(hasAdvancedVideoFrame(8, 8)).toBe(false);
    expect(hasAdvancedVideoFrame(8, 7.9)).toBe(false);
    expect(hasAdvancedVideoFrame(8, Number.NaN)).toBe(false);
    expect(hasAdvancedVideoFrame(8, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('live overlay freshness and privacy', () => {
  const playing = { paused: false, ended: false, seeking: false };
  it('keeps paused local-file analysis boxes but not paused live captures', () => {
    expect(shouldPaintLiveOverlay(null, 10_000, 1_000, { ...playing, paused: true }, false)).toBe(true);
    expect(shouldPaintLiveOverlay('tab', 10_000, 9_900, { ...playing, paused: true }, false)).toBe(false);
  });
  it('immediately removes boxes when a shared tab is muted or buffering', () => {
    expect(shouldPaintLiveOverlay('tab', 10_000, 9_999, playing, true)).toBe(false);
    expect(shouldPaintLiveOverlay('camera', 10_000, 9_999, playing, true)).toBe(false);
  });
  it('draws only if a decoded live video frame arrived recently', () => {
    expect(shouldPaintLiveOverlay('tab', 10_000, 9_000, playing, false)).toBe(true);
    expect(shouldPaintLiveOverlay('tab', 10_000, 10_000 - LIVE_OVERLAY_FRESHNESS_MS, playing, false)).toBe(true);
    expect(shouldPaintLiveOverlay('tab', 10_000, 10_000 - LIVE_OVERLAY_FRESHNESS_MS - 1, playing, false)).toBe(false);
  });
  it('does not mistake metadata or future timestamps for real frame delivery', () => {
    for (const at of [0, Number.NaN, Number.POSITIVE_INFINITY, 20_000]) {
      expect(shouldPaintLiveOverlay('tab', 10_000, at, playing, false)).toBe(false);
    }
    expect(shouldPaintLiveOverlay('tab', Number.NaN, 9_900, playing, false)).toBe(false);
  });
  it('clears overlays on ended and seeking captures', () => {
    expect(shouldPaintLiveOverlay('tab', 10_000, 9_900, { ...playing, ended: true }, false)).toBe(false);
    expect(shouldPaintLiveOverlay('tab', 10_000, 9_900, { ...playing, seeking: true }, false)).toBe(false);
  });
});
