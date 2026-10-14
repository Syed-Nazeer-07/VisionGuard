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

  it('projects motion along velocity vector during playback gaps', () => {
    // Car at x=100 with dx=100 px/sec
    store.updateFromInference([mockTrack(1, 100, 200, 100, 0)], 1.0, 1, 1000);

    // At 1.1s (0.10s after last inference update), position should project by ~10px
    const rendered = store.getTracksToRender(1.1, false, 1100);
    expect(rendered.length).toBe(1);
    expect(rendered[0].x).toBeCloseTo(110, 1);
    expect(rendered[0].observationType).toBe('predicted');
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
