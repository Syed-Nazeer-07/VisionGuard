import { describe, it, expect, vi } from 'vitest';
import { drawBoundingBoxes } from './overlay';
import type { TrackedObject } from '../types';

describe('drawBoundingBoxes', () => {
  const getMockCtx = () => {
    return {
      clearRect: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 50 }),
      fillRect: vi.fn(),
      fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  };

  const createTrack = (id: number, overrides: Partial<TrackedObject> = {}): TrackedObject => ({
    trackId: id,
    className: 'car',
    classId: 2,
    x: 100,
    y: 100,
    w: 50,
    h: 50,
    prob: 0.9,
    state: 'Confirmed',
    isOverspeed: false,
    frameCount: 1,
    timeSinceUpdate: 0,
    ...overrides
  });

  it('renders fresh tracks', () => {
    const ctx = getMockCtx();
    const tracks = [createTrack(1), createTrack(2)];
    
    // A result within the realtime freshness budget (<= 0.5s) remains visible.
    const stats = drawBoundingBoxes(ctx, tracks, 800, 600, 800, 600, false, 0.2);
    
    expect(stats.rendered).toBe(2);
    expect(stats.stale).toBe(0);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
  });

  it('skips tracks that are too old for the displayed frame', () => {
    const ctx = getMockCtx();
    const tracks = [createTrack(1), createTrack(2)];
    
    // 0.8s exceeds the freshness threshold and must not be misrepresented as current.
    const stats = drawBoundingBoxes(ctx, tracks, 800, 600, 800, 600, false, 0.8);
    
    expect(stats.rendered).toBe(0);
    expect(stats.stale).toBe(2);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(0);
  });

  it('rejects future results after a backward seek', () => {
    const ctx = getMockCtx();
    const tracks = [createTrack(1)];
    
    const stats = drawBoundingBoxes(ctx, tracks, 800, 600, 800, 600, false, -0.1);
    
    expect(stats.rendered).toBe(0);
    expect(stats.stale).toBe(1);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(0);
  });

  it('formats scalar speeds as strictly non-negative, even if speed property is negative or NaN', () => {
    const ctx = getMockCtx();
    const track = createTrack(1, { speed: -38, isEstimatedSpeed: true });
    
    drawBoundingBoxes(ctx, [track], 800, 600, 800, 600, false, 0.1);
    
    expect(ctx.fillText).toHaveBeenCalled();
    const textCalls = (ctx.fillText as any).mock.calls;
    const labelString = textCalls[0][0];
    // Must NOT contain negative speed
    expect(labelString).not.toContain('-38');
    expect(labelString).toContain('0 km/h');
  });

  it('avoids drawing stale predictions with timeSinceUpdate > 1', () => {
    const ctx = getMockCtx();
    const activeTrack = createTrack(1, { timeSinceUpdate: 0 });
    const stalePredTrack = createTrack(2, { timeSinceUpdate: 3 }); // missing for 3 frames
    
    const stats = drawBoundingBoxes(ctx, [activeTrack, stalePredTrack], 800, 600, 800, 600, false, 0.1);
    
    expect(stats.rendered).toBe(1);
    expect(stats.stale).toBe(1);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
  });

  it('handles label collision avoidance and stays within viewport', () => {
    const ctx = getMockCtx();
    // Two tracks right at the top left corner (x: 20, y: 10)
    const track1 = createTrack(1, { x: 50, y: 30, w: 60, h: 40 });
    const track2 = createTrack(2, { x: 55, y: 35, w: 60, h: 40 });
    
    drawBoundingBoxes(ctx, [track1, track2], 800, 600, 800, 600, false, 0.1);
    
    expect(ctx.fillRect).toHaveBeenCalled();
    const fillCalls = (ctx.fillRect as any).mock.calls;
    // Each label background fill rect has [x, y, w, h]
    for (const call of fillCalls) {
      const [lx, ly, lw, lh] = call;
      expect(lx).toBeGreaterThanOrEqual(0);
      expect(ly).toBeGreaterThanOrEqual(0);
      expect(lx + lw).toBeLessThanOrEqual(800);
      expect(ly + lh).toBeLessThanOrEqual(600);
    }
  });

  it('correctly maps coordinates in cover mode (fullscreen)', () => {
    const ctx = getMockCtx();
    // Source 1920x1080 inside 1920x1200 container in cover mode
    // Video is centered: scale = 1200/1080 = 1.1111, renderWidth = 2133.33, offsetX = -106.67
    const track = createTrack(1, { x: 960, y: 540, w: 200, h: 100 });
    
    drawBoundingBoxes(ctx, [track], 1920, 1200, 1920, 1080, true, 0.1);
    
    expect(ctx.strokeRect).toHaveBeenCalled();
    const [bx, by, bw, bh] = (ctx.strokeRect as any).mock.calls[0];
    // Center was at x=960, in display it should be center of 1920
    const displayedCenter = bx + bw / 2;
    expect(displayedCenter).toBeCloseTo(960, 1);
    const displayedCenterY = by + bh / 2;
    expect(displayedCenterY).toBeCloseTo(600, 1); // 1200 / 2
  });
});
