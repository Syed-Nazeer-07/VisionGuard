import { describe, it, expect } from 'vitest';
import { getRetentionMetadata, getExpirationTimestamp } from './retention';

describe('getExpirationTimestamp', () => {
  it('returns a valid ISO date string', () => {
    const ts = getExpirationTimestamp({ daysToKeep: 30 });
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('returns a date in the future for positive days', () => {
    const ts = getExpirationTimestamp({ daysToKeep: 30 });
    expect(new Date(ts).getTime()).toBeGreaterThan(Date.now());
  });

  it('returns approximately N days from now', () => {
    const days = 7;
    const ts = getExpirationTimestamp({ daysToKeep: days });
    const diff = new Date(ts).getTime() - Date.now();
    const expectedMs = days * 24 * 60 * 60 * 1000;
    // Allow 1 second drift
    expect(Math.abs(diff - expectedMs)).toBeLessThan(1000);
  });
});

describe('getRetentionMetadata', () => {
  it('returns expires_at and ready_for_cleanup=false', () => {
    const meta = getRetentionMetadata({ daysToKeep: 30 });
    expect(meta).toHaveProperty('expires_at');
    expect(meta.ready_for_cleanup).toBe(false);
  });

  it('expires_at is a valid future timestamp', () => {
    const meta = getRetentionMetadata({ daysToKeep: 14 });
    expect(new Date(meta.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});
