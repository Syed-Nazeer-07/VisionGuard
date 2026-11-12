import { describe, expect, it } from 'vitest';
import { fastestVisibleEstimate } from './analysisMetrics';

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
