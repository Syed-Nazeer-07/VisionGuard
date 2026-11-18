import { describe, expect, it } from 'vitest';
import { describeBenchmark, percentiles } from './detectorBenchmark';

describe('detector performance reporting', () => {
  it('separates detector throughput and presented video frames', () => {
    const stats = describeBenchmark(null, 'wasm', [], [], {
      busyFrames: 44, inferenceCount: 2, playMs: 2000,
      droppedVideoFrames: 1, presentedVideoFrames: 48, pageJsHeapStartBytes: null, pageJsHeapBytes: null
    });
    expect(stats.inferenceFps).toBe(1);
    expect(stats.playbackFps).toBe(24);
    expect(stats.sampledWorkerFrames).toBe(0);
    expect(stats.overlayAgeMs).toBeNull();
  });

  it('reports nearest-rank percentiles without mutating the source samples', () => {
    const values = [600, 310, 290, 320, NaN];
    expect(percentiles(values)).toEqual({ p50: 310, p95: 600 });
    expect(values[0]).toBe(600);
  });
});
