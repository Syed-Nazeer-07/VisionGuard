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
  it('retains side-by-side and overlapping motorcycle/bicycle/person boxes across different classes', () => {
    const result = nonMaxSuppression([box(3, 100, 100), box(1, 100, 100), box(0, 100, 100)], 0.45);
    expect(result.map(x => x.classId).sort()).toEqual([0, 1, 3]);
  });
  it('removes duplicate same-class boxes without mutating the caller input', () => {
    const input = [box(3, 101, 99, 45, 30, 0.4), box(3, 100, 100, 45, 30, 0.9)];
    expect(nonMaxSuppression(input, 0.45)).toHaveLength(1);
    expect(input[0].prob).toBe(0.4);
  });
  it('removes invalid and tiny degenerate detector boxes', () => {
    expect(processOutput(syntheticOutput(3, 300, 490, 0.1, 0.1, 0.9), 0.25, 0.45)).toHaveLength(0);
  });
});
