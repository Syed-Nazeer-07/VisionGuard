import { describe, expect, it } from 'vitest';
import { countBackendDetections, fastestVisibleEstimate } from './analysisMetrics';

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

describe('visible optical speed summary', () => {
  it('shows the fastest visible estimate, not a permanent placeholder', () => {
    expect(fastestVisibleEstimate([{speedKmh:28}, {speedKmh:51.2}, {speedKmh:40}])).toBe(51.2);
  });
  it('shows a real zero for a stationary tracked vehicle', () => {
    expect(fastestVisibleEstimate([{speedKmh:0}])).toBe(0);
  });
  it('does not claim motion from temporary prediction or invalid readings', () => {
    expect(fastestVisibleEstimate([{speedKmh:120,isPredicted:true}, {speedKmh:44}])).toBe(44);
    expect(fastestVisibleEstimate([{speedKmh:Infinity}, {speedKmh:-3}, {speedKmh:200}])).toBeNull();
  });
  it('resets the metric when the frame has no valid tracked vehicles', () => {
    expect(fastestVisibleEstimate([])).toBeNull();
    expect(fastestVisibleEstimate([{speedKmh:null}])).toBeNull();
  });
});
