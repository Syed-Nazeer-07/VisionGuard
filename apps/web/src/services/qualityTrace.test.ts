import { describe, expect, it } from 'vitest';
import { appendQualityFrame, appendQualityInference, QA_MAX_FRAMES, serializeQualityTrace, summarizeQualityPerformance, type QualityInference } from './qualityTrace';
import type { LiveTrack } from '../pipeline/tracker/liveProjection';

const track: LiveTrack = {
  id: 8, className: 'car', confidence: .93,
  x: 60, y: 40, w: 32, h: 20, vx: 5, vy: 0,
  motionPxPerSec: 5, isPredicted: true,
};
describe('local opt-in quality trace', () => {
  it('records the exact displayed ID and source-space box without video data', () => {
    const frames: Parameters<typeof appendQualityFrame>[0] = [];
    expect(appendQualityFrame(frames, 1, 640, 360, [track])).toBe(true);
    expect(frames).toHaveLength(1);
    expect(frames[0].groundTruth).toBeNull();
    expect(frames[0].exitedIds).toBeNull();
    expect(frames[0].predictions[0]).toMatchObject({
      id: 8, className: 'car', isPredicted: true,
      box: {x: 60, y:40, w:32, h:20},
    });
    const exported = serializeQualityTrace(frames);
    expect(exported).not.toContain('data:video');
    expect(JSON.parse(exported).annotationStatus).toContain('NOT ANNOTATED');
  });
  it('keeps monotonically increasing timestamps and throttles samples', () => {
    const frames: Parameters<typeof appendQualityFrame>[0] = [];
    expect(appendQualityFrame(frames, 1, 640, 360, [])).toBe(true);
    expect(appendQualityFrame(frames, 1.03, 640, 360, [])).toBe(false);
    expect(appendQualityFrame(frames, .9, 640, 360, [])).toBe(false);
    expect(appendQualityFrame(frames, 1.15, 640, 360, [])).toBe(true);
    expect(frames).toHaveLength(2);
  });
  it('has a hard memory limit and rejects invalid video dimensions', () => {
    const frames: Parameters<typeof appendQualityFrame>[0] = [];
    expect(appendQualityFrame(frames, 1, 0, 360, [track])).toBe(false);
    for (let i=0;i<QA_MAX_FRAMES;i++) {
      expect(appendQualityFrame(frames, i/5, 640, 360, [])).toBe(true);
    }
    expect(appendQualityFrame(frames, 600, 640, 360, [])).toBe(false);
    expect(frames).toHaveLength(QA_MAX_FRAMES);
  });
});

it('does not record a disabled overlay as an empty detection frame', () => {
  const frames: Parameters<typeof appendQualityFrame>[0] = [];
  expect(appendQualityFrame(frames, 1, 640, 360, [], null, false)).toBe(false);
  expect(appendQualityFrame(frames, 1, 640, 360, [], null, true)).toBe(true);
  expect(frames[0].predictions).toEqual([]);
});
it('exports measured timing distributions and replay misses without inventing absent timings', () => {
  const samples: QualityInference[] = [];
  const first = { mediaTime: 1, inferenceMs: 100, resultAgeMs: 80, provider: 'wasm', detectionCount: 2, replayAnchorAvailable: true };
  expect(appendQualityInference(samples, first)).toBe(true);
  expect(appendQualityInference(samples, { ...first, mediaTime: 2, inferenceMs: 900, resultAgeMs: null, replayAnchorAvailable: false })).toBe(true);
  expect(appendQualityInference(samples, { ...first, inferenceMs: NaN })).toBe(false);
  const summary = summarizeQualityPerformance([], samples);
  expect(summary.workerLatencyMs).toEqual({ samples: 2, p50: 100, p95: 900 });
  expect(summary.resultAgeMs).toEqual({ samples: 1, p50: 80, p95: 80 });
  expect(summary.overlayAgeMs).toEqual({ samples: 0, p50: null, p95: null });
  expect(summary.replayAnchorMisses).toBe(1);
  expect(JSON.parse(serializeQualityTrace([], samples)).performance).toEqual(summary);
});

it('records the actual review playback speed as evaluation context', () => {
  expect(JSON.parse(serializeQualityTrace([], [], .25)).playbackRate).toBe(.25);
  expect(JSON.parse(serializeQualityTrace([], [], NaN)).playbackRate).toBeNull();
  expect(JSON.parse(serializeQualityTrace([])).playbackRate).toBe(1);
});
