import { describe, it, expect } from 'vitest';
import { getCameraPlaybackSource, cameraSourceHost } from './cameraSources';

describe('browser camera capabilities', () => {
  it('allows valid HLS manifests with query tokens without exposing them in labels', () => {
    const cam = { source_type: 'hls', source_url: 'https://cams.example.test/live/index.m3u8?token=secret' };
    expect(getCameraPlaybackSource(cam)).toMatchObject({ playable: true, type: 'hls' });
    expect(cameraSourceHost(cam)).toBe('cams.example.test');
  });
  it('rejects unimplemented direct RTSP and YouTube playback', () => {
    expect(getCameraPlaybackSource({ source_type: 'rtsp', source_url: 'rtsp://device.local/live' }))
      .toMatchObject({ playable: false });
    expect(getCameraPlaybackSource({ source_type: 'youtube_live', source_url: 'https://youtube.com/watch?v=1' }))
      .toMatchObject({ playable: false });
    expect(getCameraPlaybackSource({ source_type: 'uploaded_video', source_url: 'clip.mp4' }))
      .toMatchObject({ playable: false });
  });
  it('rejects malformed, unsafe or non-manifest HLS sources', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://u:p@domain.test/a.m3u8', 'https://domain.test/a.mp4', 'not a url']) {
      expect(getCameraPlaybackSource({ source_type: 'hls', source_url: url }).playable).toBe(false);
    }
    expect(getCameraPlaybackSource({ source_type: 'hls', source_url: '' }).playable).toBe(false);
  });
  it('handles legacy stream_url and no source without inventing a live connection', () => {
    expect(getCameraPlaybackSource({ stream_url: 'https://camera.test/live.m3u8' }).playable).toBe(true);
    expect(getCameraPlaybackSource(null).playable).toBe(false);
    expect(getCameraPlaybackSource({ source_type: 'hls' }).playable).toBe(false);
  });
});
