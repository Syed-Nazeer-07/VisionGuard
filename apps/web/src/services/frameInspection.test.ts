import { describe, expect, it } from 'vitest';
import type { BoundingBox } from '../pipeline/types';
import { inspectionTracks, isCurrentPausedInspection } from './frameInspection';

const box: BoundingBox = {
  x: 145, y: 95, w: 62, h: 36,
  classId: 2, className: 'car', prob: .91,
};

describe('paused-frame detector inspection', () => {
  it('shows real raw candidates without assigning persistent tracking IDs or speeds', () => {
    const tracks = inspectionTracks([box, { ...box, x: 230, classId: 7, className: 'truck' }], 14.25);
    expect(tracks.map(t => t.id)).toEqual([-1, -2]);
    expect(tracks.map(t => t.className)).toEqual(['car', 'truck']);
    expect(tracks[0]).toMatchObject({ x: 145, confidence: .91, speedKmh: null, isPredicted: false });
    expect(tracks[0].lastDetectedAt).toBe(14.25);
    expect(tracks[0].motionPxPerSec).toBeNull();
  });

  it('ignores malformed geometry rather than painting invalid boxes', () => {
    expect(inspectionTracks([{ ...box, x: Number.NaN }, { ...box, w: -5 }, box], 0)).toHaveLength(1);
    expect(inspectionTracks([box], -1)).toEqual([]);
  });

  it('rejects late replies after seeking, resuming, or hiding the workspace', () => {
    expect(isCurrentPausedInspection(14.25, 14.25, true, false, true)).toBe(true);
    expect(isCurrentPausedInspection(14.25, 14.4, true, false, true)).toBe(false);
    expect(isCurrentPausedInspection(14.25, 14.25, false, false, true)).toBe(false);
    expect(isCurrentPausedInspection(14.25, 14.25, true, true, true)).toBe(false);
    expect(isCurrentPausedInspection(14.25, 14.25, true, false, false)).toBe(false);
  });
});
