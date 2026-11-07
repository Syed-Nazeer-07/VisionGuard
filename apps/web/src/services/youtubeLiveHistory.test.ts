import { describe, expect, it } from 'vitest';
import {
  normalizeYouTubeLiveUrl, parseYouTubeHistory, recordYouTubeLink,
  youtubeHistoryStorageKey, youtubeLinkLabel
} from './youtubeLiveHistory';

describe('YouTube Live link persistence', () => {
  it('accepts video, live, channel-live and short links', () => {
    expect(normalizeYouTubeLiveUrl(' https://www.youtube.com/live/AbC123 ')).toBe('https://www.youtube.com/live/AbC123');
    expect(normalizeYouTubeLiveUrl('https://youtube.com/watch?v=AbC123')).toContain('watch?v=AbC123');
    expect(normalizeYouTubeLiveUrl('https://www.youtube.com/@traffic/live')).toContain('@traffic/live');
    expect(normalizeYouTubeLiveUrl('https://youtu.be/abc123')).toBe('https://youtu.be/abc123');
  });

  it('rejects non-YouTube, embedded credentials and unsafe URL schemes', () => {
    for (const input of [
      'https://youtube.com.evil.test/watch?v=1', 'http://youtube.com/watch?v=1',
      'javascript:alert(1)', 'file:///tmp/video.mp4', 'https://youtube.com/',
      'https://user:secret@youtube.com/watch?v=1',
    ]) expect(() => normalizeYouTubeLiveUrl(input)).toThrow();
  });

  it('retains the latest six links, deduplicates and scopes keys by user', () => {
    let saved: ReturnType<typeof recordYouTubeLink> = [];
    for (let i = 1; i <= 8; i++) {
      saved = recordYouTubeLink(saved, 'https://youtube.com/live/video' + i, i);
    }
    expect(saved).toHaveLength(6);
    expect(saved[0].url).toContain('video8');
    saved = recordYouTubeLink(saved, 'https://youtube.com/live/video5', 20);
    expect(saved.filter(entry => entry.url.includes('video5'))).toHaveLength(1);
    expect(saved[0].openedAt).toBe(20);
    expect(youtubeHistoryStorageKey('alice')).not.toBe(youtubeHistoryStorageKey('bob'));
  });

  it('sanitizes malformed, duplicate, and malicious persisted link records', () => {
    const parsed = parseYouTubeHistory(JSON.stringify([
      {url:'javascript:alert(1)',openedAt:1},
      {url:'https://youtube.com/live/abc',openedAt:2},
      {url:'https://youtube.com/live/abc',openedAt:3},
      {url:'https://evil.test/live/abc',openedAt:4},
      {url:'https://youtu.be/valid',openedAt:'now'}
    ]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].url).toBe('https://youtube.com/live/abc');
    expect(parseYouTubeHistory('{broken')).toEqual([]);
    expect(parseYouTubeHistory(null)).toEqual([]);
  });

  it('generates useful labels without inferring the actual shared browser tab', () => {
    expect(youtubeLinkLabel('https://youtube.com/live/MyVideo123')).toContain('MyVideo123');
  });
});
