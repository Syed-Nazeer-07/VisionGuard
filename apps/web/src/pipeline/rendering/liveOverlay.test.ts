import { describe, expect, it, vi } from 'vitest';
import { paintLiveOverlay } from './liveOverlay';
import type { PersistentTrack } from '../tracker/stableVehicles';

const track: PersistentTrack = {
  id: 4, className: 'car', confidence: .9, x: 200, y: 400, w: 100, h: 200,
  vx: 0, vy: 0, motionPxPerSec: null, lastDetectedAt: 1, speedKmh: null, speedIsEstimate: true
};
function canvas() {
  return {
    save: vi.fn(), restore: vi.fn(), scale: vi.fn(), beginPath: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), setLineDash: vi.fn(), strokeRect: vi.fn()
  };
}
const frame = { width: 400, height: 800 };
const viewport = { width: 800, height: 450, dpr: 2 };

describe('live overlay renderer', () => {
  it('matches a portrait video’s contain geometry and distinguishes predicted boxes', () => {
    const context = canvas();
    paintLiveOverlay(context as unknown as CanvasRenderingContext2D, [{ ...track, isPredicted: true }],
      frame, viewport, new Map(), 1000, { boxes: true, labels: false });
    expect(context.scale).toHaveBeenCalledWith(2, 2);
    expect(context.rect).toHaveBeenCalledWith(287.5, 0, 225, 450);
    expect(context.strokeRect).toHaveBeenCalledWith(371.875, 168.75, 56.25, 112.5);
    expect(context.setLineDash).toHaveBeenCalledWith([4, 3]);
  });

  it('keeps visual observations available to telemetry while boxes are hidden', () => {
    const context = canvas();
    const seen = paintLiveOverlay(context as unknown as CanvasRenderingContext2D,
      [track], frame, viewport, new Map(), 1000, { boxes: false, labels: false });
    expect(seen).toEqual([track]);
    expect(context.strokeRect).not.toHaveBeenCalled();
  });
});
