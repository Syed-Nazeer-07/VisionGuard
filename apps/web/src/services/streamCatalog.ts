export interface StreamSource {
  id: string;
  name: string;
  url: string;
  format: 'hls' | 'video';
  createdAt: number;
}

const key = (owner: string) => 'visionguard:sources:' + owner;
const activeKey = (owner: string) => 'visionguard:active-stream:' + owner;

function cleanUrl(raw: string): string {
  const value = raw.trim();
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Browser analysis requires an HTTP(S) video or HLS URL. RTSP needs a secure HLS conversion server.');
  }
  if (url.username || url.password) throw new Error('Do not embed credentials in a stream URL.');
  if (value.length > 2048) throw new Error('Stream URL is too long.');
  return url.toString();
}
export function validateStream(raw: string): { url: string; format: StreamSource['format'] } {
  const url = cleanUrl(raw);
  return { url, format: /\.m3u8(?:\?|$)/i.test(url) ? 'hls' : 'video' };
}

export const streamCatalog = {
  list(owner: string): StreamSource[] {
    if (!owner) return [];
    try {
      const stored = JSON.parse(localStorage.getItem(key(owner)) || '[]');
      if (!Array.isArray(stored)) return [];
      return stored.filter(s => typeof s.id === 'string' && typeof s.name === 'string'
        && typeof s.url === 'string' && (s.format === 'video' || s.format === 'hls'));
    } catch { return []; }
  },
  add(owner: string, name: string, rawUrl: string): StreamSource {
    if (!owner) throw Error('Sign in to save stream sources.');
    const cleanName = name.trim().slice(0,80);
    if (!cleanName) throw Error('Give this video stream a name.');
    const normalized = validateStream(rawUrl);
    const streams = this.list(owner);
    const existing = streams.find(s => s.url === normalized.url);
    if (existing) return existing;
    const source: StreamSource = {
      id: crypto.randomUUID(), name: cleanName, url: normalized.url,
      format: normalized.format, createdAt: Date.now()
    };
    localStorage.setItem(key(owner), JSON.stringify([source, ...streams].slice(0,40)));
    return source;
  },
  remove(owner: string, id: string): void {
    if (!owner) return;
    localStorage.setItem(key(owner), JSON.stringify(this.list(owner).filter(s=>s.id!==id)));
    if (this.active(owner) === id) localStorage.removeItem(activeKey(owner));
  },
  active(owner: string): string | null {
    return owner ? localStorage.getItem(activeKey(owner)) : null;
  },
  select(owner: string, id: string | null) {
    if (!owner) return;
    if (id) localStorage.setItem(activeKey(owner), id);
    else localStorage.removeItem(activeKey(owner));
  }
};
