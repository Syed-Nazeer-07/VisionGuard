import { describe, expect, it } from 'vitest';
import { validateStream } from './streamCatalog';

describe('live source URLs',()=>{
  it('accepts browser-compatible direct videos and HLS playlists',()=>{
    expect(validateStream('https://example.org/camera/a.m3u8').format).toBe('hls');
    expect(validateStream('https://example.org/live.mp4').format).toBe('video');
  });
  it('refuses unsupported protocols and embedded passwords',()=>{
    expect(()=>validateStream('rtsp://camera.local/live')).toThrow('HTTP(S)');
    expect(()=>validateStream('javascript:alert(1)')).toThrow('HTTP(S)');
    expect(()=>validateStream('https://name:password@example.org/live.mp4')).toThrow('credentials');
  });
});
