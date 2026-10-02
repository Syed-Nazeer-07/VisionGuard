import { describe, it, expect } from 'vitest';
import { getIOU } from '../tracker/matching';

describe('getIOU', () => {
  it('returns 1 for identical boxes', () => {
    const box = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    expect(getIOU(box, box)).toBeCloseTo(1.0, 3);
  });

  it('returns 0 for non-overlapping boxes', () => {
    const box1 = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 };
    const box2 = { x: 0.9, y: 0.9, w: 0.1, h: 0.1 };
    expect(getIOU(box1, box2)).toBeCloseTo(0, 5);
  });

  it('returns value between 0 and 1 for partial overlap', () => {
    const box1 = { x: 0.4, y: 0.5, w: 0.4, h: 0.4 };
    const box2 = { x: 0.6, y: 0.5, w: 0.4, h: 0.4 };
    const iou = getIOU(box1, box2);
    expect(iou).toBeGreaterThan(0);
    expect(iou).toBeLessThan(1);
  });

  it('is symmetric', () => {
    const box1 = { x: 0.3, y: 0.3, w: 0.3, h: 0.3 };
    const box2 = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    expect(getIOU(box1, box2)).toBeCloseTo(getIOU(box2, box1), 8);
  });

  it('handles zero-area boxes without NaN', () => {
    const box1 = { x: 0.5, y: 0.5, w: 0, h: 0 };
    const box2 = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    const iou = getIOU(box1, box2);
    expect(Number.isNaN(iou)).toBe(false);
    expect(iou).toBeGreaterThanOrEqual(0);
  });
});
