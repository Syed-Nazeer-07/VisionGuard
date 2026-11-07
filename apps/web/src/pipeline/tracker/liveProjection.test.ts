import { describe, expect, it } from 'vitest';
import { calculateMotion, projectLiveTracks, type LiveTrack } from './liveProjection';

const vehicle: LiveTrack = {
  id: 7, className: 'car', confidence: 0.92,
  x: 100, y: 60, w: 42, h: 28, vx: 50, vy: 0, motionPxPerSec: 50
};

describe('live playback projected vehicle overlays', () => {
  it('projects source-space boxes smoothly at intermediate display frame times', () => {
    const result = projectLiveTracks([vehicle], 2, 2.12, 200, 100);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBeCloseTo(106);
    expect(result[0].w).toBe(42);
  });
  it('immediately removes boxes beyond the video edge', () => {
    const leaving = { ...vehicle, x: 203, w: 24, vx: 100 };
    expect(projectLiveTracks([leaving], 2, 2.18, 200, 100)).toEqual([]);
  });
  it('removes a departing vehicle while a clipped ghost would still have been displayed', () => {
    const leaving = { ...vehicle, x: 189, w: 46, vx: 0 };
    // Only 73.9% visible initially (still on screen), but after moving
    // farther off the image boundary less than 60% remains, so hide.
    expect(projectLiveTracks([{ ...leaving, x: 198 }], 2, 2.1, 200, 100)).toEqual([]);
    expect(projectLiveTracks([{ ...leaving, x: 182 }], 2, 2.1, 200, 100)).toHaveLength(1);
  });
  it('does not display a car whose center has already left the source image', () => {
    const leaving = { ...vehicle, x: 201, w: 100, vx: 0 };
    expect(projectLiveTracks([leaving], 2, 2.05, 200, 100)).toEqual([]);
  });
  it('suppresses stale boxes rather than leaving them floating on the scene', () => {
    expect(projectLiveTracks([vehicle], 2, 2.56, 200, 100)).toEqual([]);
  });
  it('discards results after a backwards seek', () => {
    expect(projectLiveTracks([vehicle], 3, 2.5, 200, 100)).toEqual([]);
  });
  it('rejects invalid geometry and insufficient detection confidence', () => {
    expect(projectLiveTracks([{ ...vehicle, w: NaN }], 2, 2.1, 200, 100)).toEqual([]);
    expect(projectLiveTracks([{ ...vehicle, confidence: 0.1 }], 2, 2.1, 200, 100)).toEqual([]);
  });
  it('measures source-pixel motion while refusing fake km/h for first sighting', () => {
    expect(calculateMotion(undefined, vehicle, 2).motionPxPerSec).toBeNull();
    const p = calculateMotion({ x: 50, y: 60, h: 28, time: 1, vx: 0, vy: 0 }, vehicle, 2);
    expect(p.motionPxPerSec).toBeCloseTo(30);
  });
});
