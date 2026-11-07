import { describe, expect, it } from 'vitest';
import { normalizeVideoPageUrl } from './videoPageUrls';

describe('public camera page launcher', () => {
  it('accepts ordinary YouTube Live and government camera webpages', () => {
    expect(normalizeVideoPageUrl(' https://www.youtube.com/live/abc123 ')).toBe('https://www.youtube.com/live/abc123');
    expect(normalizeVideoPageUrl('https://www.511virginia.org/')).toBe('https://www.511virginia.org/');
  });
  it('rejects scripts, local files, data URIs and embedded passwords', () => {
    for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'https://user:secret@example.org/']) {
      expect(() => normalizeVideoPageUrl(value)).toThrow();
    }
  });
  it('explains missing and incomplete URLs', () => {
    expect(() => normalizeVideoPageUrl('')).toThrow('Paste a YouTube Live');
    expect(() => normalizeVideoPageUrl('youtube.com/live/123')).toThrow('starting with https://');
  });
});
