import { describe, expect, it } from 'vitest';
import { hiddenPagePolicy, shouldResumeSharedTab } from './captureVisibility';

describe('live capture visibility policy', () => {
  it('preserves consented YouTube tab sharing when browser focuses the YouTube tab', () => {
    expect(hiddenPagePolicy('tab')).toEqual({
      pauseMedia: false,
      releaseCapture: false,
    });
  });
  it('still stops device camera when the app is hidden', () => {
    expect(hiddenPagePolicy('camera')).toEqual({
      pauseMedia: true,
      releaseCapture: true,
    });
  });
  it('pauses ordinary uploaded videos on hide', () => {
    expect(hiddenPagePolicy(null)).toEqual({
      pauseMedia: true,
      releaseCapture: false,
    });
  });
});

describe('shared-tab preview restoration', () => {
  it('resumes a paused YouTube-tab preview when returning to VisionGuard', () => {
    expect(shouldResumeSharedTab('tab', false, true)).toBe(true);
  });
  it('does not restart capture while hidden or resume regular webcam footage', () => {
    expect(shouldResumeSharedTab('tab', true, true)).toBe(false);
    expect(shouldResumeSharedTab('tab', false, false)).toBe(false);
    expect(shouldResumeSharedTab('camera', false, true)).toBe(false);
    expect(shouldResumeSharedTab(null, false, true)).toBe(false);
  });
});
