import { describe, it, expect } from 'vitest';
import { getIOU, classGroup, matchDetectionsToTracks } from './matching';
import type { BoundingBox } from '../types';

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
    expect(box1 && box2 && getIOU(box1, box2)).toBeCloseTo(getIOU(box2, box1), 8);
  });

  it('handles zero-area boxes without NaN', () => {
    const box1 = { x: 0.5, y: 0.5, w: 0, h: 0 };
    const box2 = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    const iou = getIOU(box1, box2);
    expect(Number.isNaN(iou)).toBe(false);
    expect(iou).toBeGreaterThanOrEqual(0);
  });
});

describe('classGroup and matching gating', () => {
  it('groups vehicle classes (car, bus, truck) together', () => {
    expect(classGroup(2)).toBe(2); // car
    expect(classGroup(5)).toBe(2); // bus
    expect(classGroup(7)).toBe(2); // truck
    expect(classGroup(0)).toBe(0); // person
    expect(classGroup(1)).toBe(1); // bicycle
    expect(classGroup(3)).toBe(3); // motorcycle
  });

  it('permits car-to-truck association while rejecting person-to-car association', () => {
    const fakeTrack = {
      getState: () => ({ cx: 100, cy: 100, w: 50, h: 50 }),
      classId: 2 // car
    };

    // Detection 1: truck (class 7) at same location -> allowed
    const truckDet: BoundingBox = { x: 100, y: 100, w: 50, h: 50, prob: 0.9, classId: 7, className: 'truck' };
    const resTruck = matchDetectionsToTracks([truckDet], [fakeTrack], 0.2);
    expect(resTruck.matches.length).toBe(1);

    // Detection 2: person (class 0) at same location -> blocked by gating
    const personDet: BoundingBox = { x: 100, y: 100, w: 50, h: 50, prob: 0.9, classId: 0, className: 'person' };
    const resPerson = matchDetectionsToTracks([personDet], [fakeTrack], 0.2);
    expect(resPerson.matches.length).toBe(0);
    expect(resPerson.unmatchedDetections).toEqual([0]);
  });
});
