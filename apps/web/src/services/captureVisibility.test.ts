import { describe, expect, it } from 'vitest';
import { hiddenPagePolicy } from './captureVisibility';

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
