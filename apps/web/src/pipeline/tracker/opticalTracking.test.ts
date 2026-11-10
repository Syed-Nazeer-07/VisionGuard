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
