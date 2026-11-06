import { describe, it, expect, beforeEach } from 'vitest';
import { TrackStateStore } from './trackStore';
import type { TrackedObject } from '../types';

describe('TrackStateStore', () => {
  let store: TrackStateStore;

  const mockTrack = (id: number, x: number = 100, y: number = 200, dx: number = 50, dy: number = 10): TrackedObject => ({
    trackId: id,
    x,
    y,
    w: 80,
    h: 50,
    dx,
    dy,
    prob: 0.85,
    classId: 2,
    className: 'car',
    state: 'Confirmed',
    frameCount: 10,
    timeSinceUpdate: 0,
    hitCount: 5,
    observationType: 'detection'
  });

  beforeEach(() => {
    store = new TrackStateStore();
    store.setGeneration(1);
  });

  it('ingests and renders fresh tracks', () => {
    store.updateFromInference([mockTrack(1), mockTrack(2)], 1.0, 1, 1000);
    expect(store.size).toBe(2);

    const rendered = store.getTracksToRender(1.0, false, 1000);
    expect(rendered.length).toBe(2);
    expect(rendered[0].trackId).toBe(1);
    expect(rendered[1].trackId).toBe(2);
  });

  it('does NOT clear active tracks when an inference result has empty detections', () => {
    store.updateFromInference([mockTrack(1, 100, 200, 10, 0)], 1.0, 1, 1000);

    // Incoming inference with 0 detections (e.g. transient occlusion)
    store.updateFromInference([], 1.1, 1, 1100);

    // Track should still be preserved in the store!
    expect(store.size).toBe(1);
    const rendered = store.getTracksToRender(1.15, false, 1150);
    expect(rendered.length).toBe(1);
    expect(rendered[0].trackId).toBe(1);
  });

  it('does not create phantom tracks from a tracker prediction with no detection', () => {
    store.updateFromInference([{
      ...mockTrack(22, 480, 240), observationType: 'predicted', timeSinceUpdate: 1
    }], 1.0, 1, 1000);
    expect(store.size).toBe(0);
    expect(store.getTracksToRender(1.05, false, 1050)).toEqual([]);
  });

  it('never resets the last *observed* position or freshness on predicted updates', () => {
    store.updateFromInference([mockTrack(3, 100, 200)], 1.0, 1, 1000);
    store.updateFromInference([mockTrack(3, 110, 200)], 1.1, 1, 1100);
    const beforePrediction = store.getTracksToRender(1.1, false, 1100)[0].x;

    // The backend reported an implausible predicted box. The renderer must
    // retain the last measured position, not jump to that phantom prediction.
    store.updateFromInference([{
      ...mockTrack(3, 950, 750), observationType: 'predicted', timeSinceUpdate: 1
    }], 1.2, 1, 1200);
    const shown = store.getTracksToRender(1.2, false, 1200)[0];
    expect(shown.x).toBeGreaterThanOrEqual(beforePrediction);
    expect(shown.x).toBeLessThan(130);

    // A new true detection estimates velocity from original 110px at 1.1s,
    // not 950px at 1.2s. ID and measured history are preserved.
    store.updateFromInference([mockTrack(3, 120, 200)], 1.3, 1, 1300);
    expect(store.getTracksToRender(1.3, false, 1300)[0].x).toBeGreaterThan(110);
    expect(store.getTracksToRender(1.3, false, 1300)[0].x).toBeLessThan(130);
  });

  it('expires after the last real detection even if predicted boxes keep arriving', () => {
    store.updateFromInference([mockTrack(4)], 1.0, 1, 1000);
    for (let step = 1; step <= 8; step++) {
      store.updateFromInference([{
        ...mockTrack(4, 100 + step * 50), observationType: 'predicted',
        timeSinceUpdate: step
      }], 1 + step * 0.16, 1, 1000 + step * 160);
    }
    expect(store.size).toBe(0);
  });

  it('ignores interpolated frames when determining observation freshness', () => {
    store.updateFromInference([mockTrack(7, 220, 140)], 0.5, 1, 500);
    store.updateFromInference([{
      ...mockTrack(7, 420, 140), observationType: 'interpolated', timeSinceUpdate: 0
    }], 0.6, 1, 600);
    expect(store.getTracksToRender(0.6, false, 600)[0].x).toBe(220);
  });

  it('projects motion using consecutive measured boxes rather than frame-based Kalman velocity', () => {
    store.updateFromInference([mockTrack(1, 100, 200, 9000, 0)], 1.0, 1, 1000);
    store.updateFromInference([mockTrack(1, 110, 200, 9000, 0)], 1.1, 1, 1100);
    // Raw displacement is 10px per 0.1s = 100px/s. Kalman dx=9000 is
    // deliberately nonsense; extrapolation must be bounded to observed speed.
    const last = store.getTracksToRender(1.1, false, 1100)[0];
    const predicted = store.getTracksToRender(1.2, false, 1200)[0];
    expect(predicted.x).toBeGreaterThan(last.x);
    expect(predicted.x).toBeLessThan(120);
    expect(predicted.observationType).toBe('predicted');
  });


  it('does not extrapolate boxes before obtaining two actual detections', () => {
    store.updateFromInference([mockTrack(12, 100, 200, 800, 0)], 1.0, 1, 1000);
    expect(store.getTracksToRender(1.12, false, 1120)[0].x).toBe(100);
  });

  it('snaps to the actual box rather than carrying a stale velocity after a large tracking jump', () => {
    store.updateFromInference([mockTrack(9, 100, 200, 0, 0)], 1.0, 1, 1000);
    store.updateFromInference([mockTrack(9, 110, 200, 0, 0)], 1.1, 1, 1100);
    store.updateFromInference([mockTrack(9, 450, 200, 0, 0)], 1.2, 1, 1200);
    const current = store.getTracksToRender(1.2, false, 1200)[0];
    expect(current.x).toBe(450);
    expect(store.getTracksToRender(1.3, false, 1300)[0].x).toBe(450);
  });

  it('disables velocity projection while video is paused', () => {
    store.updateFromInference([mockTrack(1, 100, 200, 100, 0)], 1.0, 1, 1000);

    // Paused at 1.05s
    const rendered = store.getTracksToRender(1.05, true, 1050);
    expect(rendered.length).toBe(1);
    expect(rendered[0].x).toBe(100); // Unaltered center coordinate
  });

  it('expires genuinely lost tracks after multiple misses and retention limit', () => {
    store.updateFromInference([mockTrack(1)], 1.0, 1, 1000);

    // Miss 1, 2, 3, 4, 5, 6
    for (let i = 1; i <= 6; i++) {
      store.updateFromInference([], 1.0 + i * 0.15, 1, 1000 + i * 150);
    }

    expect(store.size).toBe(0);
    const rendered = store.getTracksToRender(2.0, false, 2000);
    expect(rendered.length).toBe(0);
  });

  it('discards tracks from older source generations', () => {
    store.updateFromInference([mockTrack(1)], 1.0, 1, 1000);
    expect(store.size).toBe(1);

    // Switch video / bump generation
    store.setGeneration(2);
    expect(store.size).toBe(0);

    // Stale result from generation 1 should be rejected
    store.updateFromInference([mockTrack(1)], 1.2, 1, 1200);
    expect(store.size).toBe(0);
  });

  it('clears all tracks on explicit clear (e.g. seek)', () => {
    store.updateFromInference([mockTrack(1), mockTrack(2)], 1.0, 1, 1000);
    expect(store.size).toBe(2);

    store.clear();
    expect(store.size).toBe(0);
    expect(store.getTracksToRender(1.0, false, 1000).length).toBe(0);
  });
});
