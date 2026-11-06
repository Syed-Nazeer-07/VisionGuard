import { describe, expect, it } from 'vitest';
import { countBackendDetections } from './analysisMetrics';

describe('countBackendDetections', () => {
  it('does not mistake processed frames for vehicle detections', () => {
    expect(countBackendDetections([
      { detection_count: 3, boxes: [{}, {}, {}] },
      { detection_count: 0, boxes: [] },
      { detection_count: 2, boxes: [{}, {}] },
    ])).toBe(5);
  });

  it('does not count interpolated or empty frames', () => {
    expect(countBackendDetections([
      { detection_count: 0, boxes: [] },
      { detection_count: 0, boxes: [] },
    ])).toBe(0);
  });

  it('uses authoritative backend summary when available', () => {
    expect(countBackendDetections([{ detection_count: 2 }], 17)).toBe(17);
    expect(countBackendDetections([{ detection_count: 2 }], 0)).toBe(0);
  });

  it('falls back to boxes for old artifact records without a detection count', () => {
    expect(countBackendDetections([{ boxes: [{}, {}] }, { boxes: [] }])).toBe(2);
  });

  it('rejects invalid reported counts', () => {
    expect(countBackendDetections([{ detection_count: 4 }], -1)).toBe(4);
    expect(countBackendDetections([{ detection_count: 4 }], Number.NaN)).toBe(4);
  });
});
