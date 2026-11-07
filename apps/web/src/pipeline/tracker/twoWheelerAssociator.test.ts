import { describe, expect, it } from 'vitest';
import { TwoWheelerAssociator } from './twoWheelerAssociator';
import type { BoundingBox } from '../types';

function vehicle(classId: number, prob: number, x = 100): BoundingBox {
  return {
    x, y: 110, w: 14, h: 21, prob,
    classId, className: classId === 3 ? 'motorcycle' : classId === 1 ? 'bicycle' : 'car'
  };
}

describe('two-wheeler tracker independent from four-wheel filters', () => {
  it('emits a small motorcycle with score below the car confidence gate', () => {
    const tracker = new TwoWheelerAssociator();
    const found = tracker.update([vehicle(3, .36), vehicle(2, .95)], 1);
    expect(found).toHaveLength(1);
    expect(found[0].className).toBe('motorcycle');
    expect(found[0].confidence).toBeCloseTo(.36);
  });
  it('holds weak first-sighting motorcycles until another consistent observation', () => {
    const tracker = new TwoWheelerAssociator();
    expect(tracker.update([vehicle(3, .29)], 1)).toEqual([]);
    const found = tracker.update([vehicle(3, .30, 104)], 1.7);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(-1);
  });
  it('reuses individual motorcycle IDs in crowded scenes', () => {
    const tracker = new TwoWheelerAssociator();
    const a = tracker.update([vehicle(3, .72, 90), vehicle(3, .67, 290)], 1);
    expect(a).toHaveLength(2);
    const b = tracker.update([vehicle(3, .76, 294), vehicle(3, .75, 94)], 1.4);
    expect(b).toHaveLength(2);
    expect(new Set(a.map(x => x.id))).toEqual(new Set(b.map(x => x.id)));
  });
  it('does not treat a car or pedestrian as a motorcycle', () => {
    const tracker = new TwoWheelerAssociator();
    expect(tracker.update([vehicle(2, .99)], 1)).toEqual([]);
    expect(tracker.update([{ ...vehicle(3, .99), classId: 0, className: 'person' }], 2)).toEqual([]);
  });
});
