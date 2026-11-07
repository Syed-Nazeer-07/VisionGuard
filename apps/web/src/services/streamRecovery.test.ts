import { describe, expect, it } from 'vitest';
import { hasAdvancedVideoFrame, isStreamStalled, liveRetryDelay } from './streamRecovery';

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
