import { describe, expect, it } from 'vitest';
import { validateStream } from './streamCatalog';

describe('live source URLs',()=>{
  it('accepts browser-compatible direct videos and HLS playlists',()=>{
    expect(validateStream('https://example.org/camera/a.m3u8').format).toBe('hls');
    expect(validateStream('https://example.org/camera/a.m3u8?quality=auto#live').format).toBe('hls');
    expect(validateStream('https://example.org/live.mp4').format).toBe('video');
  });
  it('explains why a YouTube page link needs explicit browser tab capture',()=>{
    expect(()=>validateStream('https://www.youtube.com/live/AbCd123')).toThrow('Analyze browser tab');
    expect(()=>validateStream('https://youtu.be/AbCd123')).toThrow('Analyze browser tab');
  });
  it('refuses unsupported protocols and embedded passwords',()=>{
    expect(()=>validateStream('rtsp://camera.local/live')).toThrow('HTTP(S)');
    expect(()=>validateStream('javascript:alert(1)')).toThrow('HTTP(S)');
    expect(()=>validateStream('https://name:password@example.org/live.mp4')).toThrow('credentials');
  });
});
