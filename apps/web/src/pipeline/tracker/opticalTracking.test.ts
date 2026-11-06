import { describe, expect, it } from 'vitest';
import { advanceOpticalTracks, type GrayFrame } from './opticalTracking';
import type { LiveTrack } from './liveProjection';

function makeFrame(t: number, offsetX: number, offsetY = 0): GrayFrame {
  const width = 100; const height = 80;
  const pixels = new Uint8Array(width * height);
  // A moving textured vehicle on a flat road. Strong features disambiguate
  // the frame-to-frame translation.
  for (let y = 27; y < 53; y++) {
    for (let x = 27; x < 53; x++) {
      const px = x + offsetX;
      const py = y + offsetY;
      if (px >= 0 && px < width && py >= 0 && py < height) {
        pixels[py * width + px] = (x * 31 + y * 17) % 210 + 35;
      }
    }
  }
  return { time: t, width, height, sourceWidth: width, sourceHeight: height, pixels };
}

const vehicle: LiveTrack = {
  id: 10, className: 'car', confidence: .92,
  x: 40, y: 40, w: 24, h: 24, vx: 0, vy: 0, motionPxPerSec: null
};

describe('optical tracking between slow YOLO observations', () => {
  it('follows a textured vehicle from one displayed video frame to the next', () => {
    const first = makeFrame(2, 0);
    const next = makeFrame(2.1, 4);
    const result = advanceOpticalTracks([vehicle], first, next);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBeCloseTo(44, 0);
    expect(result[0].motionPxPerSec).toBeGreaterThan(0);
    expect(result[0].id).toBe(10);
  });
  it('removes a vehicle when its appearance disappears', () => {
    const empty = makeFrame(2.1, 100);
    const result = advanceOpticalTracks([vehicle], makeFrame(2, 0), empty);
    expect(result).toHaveLength(0);
  });
  it('drops broken temporal sequences rather than projecting stale objects', () => {
    expect(advanceOpticalTracks([vehicle], makeFrame(2, 0), makeFrame(3, 4))).toEqual([]);
  });
});
