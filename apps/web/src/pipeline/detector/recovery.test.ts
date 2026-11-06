import { describe, expect, it } from 'vitest';
import { nonMaxSuppression, processOutput } from './postprocess';
import type { BoundingBox } from '../types';

function box(classId: number, x: number, y: number, w = 50, h = 30, prob = 0.9): BoundingBox {
  return { classId, className: classId === 3 ? 'motorcycle' : classId === 1 ? 'bicycle' : classId === 0 ? 'person' : 'car', x, y, w, h, prob };
}

function syntheticOutput(classId: number, cx: number, cy: number, w: number, h: number, confidence: number) {
  const output = new Float32Array(84 * 8400);
  output[0] = cx; output[8400] = cy; output[2 * 8400] = w; output[3 * 8400] = h;
  output[(4 + classId) * 8400] = confidence;
  return output;
}

describe('vehicle-sensitive detector postprocessing', () => {
  it('retains a small lower-frame motorcycle rather than applying a hardcoded 65px road-height rule', () => {
    const output = syntheticOutput(3, 300, 490, 12, 16, 0.78);
    const result = processOutput(output, 0.25, 0.45, 1, 0, 0, 640, 640);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ classId: 3, x: 300, y: 490, w: 12, h: 16 });
  });
  it('rejects uncertain CAR and PERSON road artifacts without excluding an equally scored small motorcycle', () => {
    // Regression for the reported manhole CAR and roadside bollard PERSON
    // false positives: class-specific confidence is a heuristic, not a
    // semantic understanding of road surface objects.
    expect(processOutput(syntheticOutput(2, 340, 490, 65, 29, .32), .40, .45)).toEqual([]);
    expect(processOutput(syntheticOutput(0, 60, 500, 13, 42, .52), .40, .45)).toEqual([]);
    const motorcycle = processOutput(syntheticOutput(3, 340, 490, 13, 29, .32), .40, .45);
    expect(motorcycle).toHaveLength(1);
    expect(motorcycle[0].classId).toBe(3);
  });

  it('retains side-by-side and overlapping motorcycle/bicycle/person boxes across different classes', () => {
    const result = nonMaxSuppression([box(3, 100, 100), box(1, 100, 100), box(0, 100, 100)], 0.45);
    expect(result.map(x => x.classId).sort()).toEqual([0, 1, 3]);
  });
  it('removes duplicate same-class boxes without mutating the caller input', () => {
    const input = [box(3, 101, 99, 45, 30, 0.4), box(3, 100, 100, 45, 30, 0.9)];
    expect(nonMaxSuppression(input, 0.45)).toHaveLength(1);
    expect(input[0].prob).toBe(0.4);
  });
  it('clips partially visible motorcycles at the image edge without shifting the centre incorrectly', () => {
    const output = syntheticOutput(3, 5, 620, 30, 50, 0.93);
    const result = processOutput(output, 0.2, 0.45, 1, 0, 0, 640, 640);
    expect(result).toHaveLength(1);
    const box = result[0];
    expect(box.x).toBeCloseTo(10, 5);
    expect(box.y).toBeCloseTo(617.5, 5);
    expect(box.w).toBeCloseTo(20, 5);
    expect(box.h).toBeCloseTo(45, 5);
    expect(box.x - box.w / 2).toBeGreaterThanOrEqual(0);
    expect(box.y + box.h / 2).toBeLessThanOrEqual(640);
  });

  it('unletterboxes and clips a motorcycle within a 1920x1080 source image', () => {
    // 1920x1080 -> 640x360 centered in 640x640, 140px top/bottom padding.
    // Object extends 15px into the top letterbox and must clip to y=0.
    const output = syntheticOutput(3, 320, 155, 60, 60, 0.9);
    const result = processOutput(output, 0.2, 0.45, 1 / 3, 0, 140, 1920, 1080);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBeCloseTo(960, 5);
    expect(result[0].y).toBeCloseTo(67.5, 5);
    expect(result[0].w).toBeCloseTo(180, 5);
    expect(result[0].h).toBeCloseTo(135, 5);
  });

  it('ignores malformed tensor shapes or invalid letterbox ratios', () => {
    const output = syntheticOutput(3, 300, 300, 20, 15, 0.9);
    expect(processOutput(new Float32Array(10), 0.2, 0.45)).toEqual([]);
    expect(processOutput(output, 0.2, 0.45, 0)).toEqual([]);
    expect(processOutput(output, 0.2, 0.45, Number.NaN)).toEqual([]);
  });

  it('removes invalid and tiny degenerate detector boxes', () => {
    expect(processOutput(syntheticOutput(3, 300, 490, 0.1, 0.1, 0.9), 0.25, 0.45)).toHaveLength(0);
  });
});
