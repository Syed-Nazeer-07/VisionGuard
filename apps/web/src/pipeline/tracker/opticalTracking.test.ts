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
  it('keeps a low-texture vehicle by matching its edges instead of blinking', () => {
    const edgeFrame = (time: number, shift: number): GrayFrame => {
      const width = 100, height = 80;
      const pixels = new Uint8Array(width * height);
      for (let y = 28; y <= 52; y++) {
        for (let x = 28; x <= 52; x++) {
          // Only a thin, identifiable vehicle perimeter contains detail;
          // the central roof is featureless (common in traffic footage).
          if (x > 30 && x < 50 && y > 30 && y < 50) continue;
          const sampleX = x + shift;
          if (sampleX >= 0 && sampleX < width) {
            pixels[y * width + sampleX] = 50 + (x * 13 + y * 31) % 170;
          }
        }
      }
      return { time, width, height, sourceWidth: width, sourceHeight: height, pixels };
    };
    const previous = edgeFrame(2, 0);
    const current = edgeFrame(2.10, 3);
    const tracked = advanceOpticalTracks([vehicle], previous, current);
    expect(tracked).toHaveLength(1);
    expect(tracked[0].x).toBeCloseTo(43, 0);
    expect(tracked[0].lastOpticalAt).toBe(2.10);
  });

  it('removes a vehicle when its appearance disappears', () => {
    const empty = makeFrame(2.1, 100);
    const result = advanceOpticalTracks([vehicle], makeFrame(2, 0), empty);
    expect(result).toHaveLength(0);
  });
  it('drops broken temporal sequences rather than projecting stale objects', () => {
    expect(advanceOpticalTracks([vehicle], makeFrame(2, 0), makeFrame(3, 4))).toEqual([]);
  });
  it('recovers a real car after a single lost optical frame when textured pixels move', () => {
    const before = makeFrame(2, 0);
    const after = makeFrame(2.1, 4);
    const predicted: LiveTrack = { ...vehicle, isPredicted: true, vx: 40, vy: 0 };
    const recovered = advanceOpticalTracks([predicted], before, after);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].id).toBe(10);
    expect(recovered[0].x).toBeCloseTo(44, 0);
    expect(recovered[0].isPredicted).toBe(false);
    expect(recovered[0].lastOpticalAt).toBe(2.1);
  });

  it('does not relock a predicted bridge onto stationary road texture', () => {
    const previous = makeFrame(2, 0);
    const unchangedRoad = makeFrame(2.1, 0);
    const predicted = { ...vehicle, isPredicted: true, x: 42, vx: 40 };
    expect(advanceOpticalTracks([predicted], previous, unchangedRoad)).toEqual([]);
  });

  it('rejects a moving car that mysteriously freezes on the same road pixels', () => {
    const staticPrevious = makeFrame(2, 0);
    const staticCurrent = makeFrame(2.1, 0);
    const moving = { ...vehicle, vx: 80, vy: 0 };
    expect(advanceOpticalTracks([moving], staticPrevious, staticCurrent)).toEqual([]);
    // A truly stationary vehicle can still have a legitimate zero-motion match.
    const stationary = advanceOpticalTracks([vehicle], staticPrevious, staticCurrent);
    expect(stationary).toHaveLength(1);
    expect(stationary[0].x).toBeCloseTo(vehicle.x);
  });

  it('keeps a small textured motorcycle across nearby frames without relaxing car matching', () => {
    const small = (time: number, shift: number): GrayFrame => {
      const width = 100, height = 80;
      const pixels = new Uint8Array(width * height);
      for (let y = 35; y < 44; y++) {
        for (let x = 46; x < 55; x++) {
          pixels[y * width + x + shift] = (x * 47 + y * 31) % 230 + 20;
        }
      }
      return { time, width, height, sourceWidth: width, sourceHeight: height, pixels };
    };
    const motor: LiveTrack = {
      ...vehicle, id: 51, className: 'motorcycle',
      x: 50, y: 39, w: 7, h: 7
    };
    const result = advanceOpticalTracks([motor], small(1, 0), small(1.1, 2));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(51);
    expect(result[0].x).toBeCloseTo(52, 0);
  });

});

it('updates the scale of an approaching car from separated matching features', () => {
  const textured = (time: number, growth: number, offset: number): GrayFrame => {
    const width = 120, height = 110;
    const pixels = new Uint8Array(width * height);
    const centers = [[0,0], [-11,-11], [11,-11], [-11,11], [11,11], [0,-14], [0,14]];
    centers.forEach(([x,y], index) => {
      const cx = 60 + Math.round(x * growth) + offset;
      const cy = 55 + Math.round(y * growth);
      for (let py = -4; py <= 4; py++) {
        for (let px = -4; px <= 4; px++) {
          const pattern = 50 + (index * 61 + (px + 4) * 37 + (py + 4) * 29 + px * py * 13) % 170;
          pixels[(cy + py) * width + cx + px] = pattern;
        }
      }
    });
    return { time, width, height, sourceWidth: width, sourceHeight: height, pixels };
  };
  const target = { ...vehicle, x: 60, y: 55, w: 58, h: 58 };
  const [updated] = advanceOpticalTracks([target], textured(1, 1, 0), textured(1.1, 1.12, 2));
  expect(updated.x).toBeCloseTo(62, 0);
  expect(updated.w).toBeGreaterThan(62);
  expect(updated.w).toBeLessThan(67);
  expect(updated.h / updated.w).toBe(1);
  const [translated] = advanceOpticalTracks([target], textured(1, 1, 0), textured(1.1, 1, 2));
  expect(translated.w).toBe(58);
});

it('rejects malformed optical frames and invalid track geometry rather than drawing guesses', () => {
  const before = makeFrame(2, 0);
  const after = makeFrame(2.1, 4);
  expect(advanceOpticalTracks([vehicle], before, { ...after, pixels: new Uint8Array(4) })).toEqual([]);
  expect(advanceOpticalTracks([vehicle], before, { ...after, time: NaN })).toEqual([]);
  expect(advanceOpticalTracks([{ ...vehicle, confidence: NaN }], before, after)).toEqual([]);
});
