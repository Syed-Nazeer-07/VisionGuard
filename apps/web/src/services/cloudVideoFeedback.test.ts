import { describe, expect, it } from 'vitest';
import { describeCloudVideoFailure } from './cloudVideoFeedback';

describe('cloud upload feedback without server credentials', () => {
  it('translates the missing B2 configuration shown in the live recording', () => {
    const input = 'video-storage create-upload: Video storage is not configured on the server (missing: B2_ENDPOINT, B2_REGION, B2_BUCKET, B2_KEY_ID, B2_APPLICATION_KEY)';
    const result = describeCloudVideoFailure(input);
    expect(result.kind).toBe('not_configured');
    expect(result.message).toContain('Keep this video on this device');
    expect(result.message).not.toContain('B2_APPLICATION_KEY');
    expect(result.message).not.toContain('B2_KEY_ID');
  });
  it('handles the shorter missing-secret error without showing raw environment names', () => {
    const result = describeCloudVideoFailure(new Error('missing B2_BUCKET'));
    expect(result.kind).toBe('not_configured');
    expect(result.message).not.toContain('B2_BUCKET');
  });
  it('does not confuse a genuine network or signed-link failure with missing credentials', () => {
    const result = describeCloudVideoFailure('Part upload timed out');
    expect(result).toEqual({ kind: 'other', message: 'Part upload timed out' });
  });
  it('has actionable fallback feedback for missing error details', () => {
    expect(describeCloudVideoFailure('').message).toContain('keep the original');
  });
});
