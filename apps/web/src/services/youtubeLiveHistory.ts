/**
 * Browser-only link history. This persists a *page link*, never a captured
 * MediaStream or Google/YouTube authorization token. Storage is per account.
 */
export interface YouTubeLiveLink {
  url: string;
  openedAt: number;
}
export const YOUTUBE_HISTORY_LIMIT = 6;

export function normalizeYouTubeLiveUrl(input: string): string {
  const raw = input.trim();
  if (!raw || raw.length > 2048) throw new Error('Paste a valid YouTube Live link.');
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error('Enter a full YouTube link starting with https://'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' ||
      (host !== 'youtube.com' && !host.endsWith('.youtube.com') && host !== 'youtu.be') ||
      url.username || url.password) {
    throw new Error('Use an HTTPS youtube.com or youtu.be link without embedded credentials.');
  }
  const path = url.pathname;
  if (host === 'youtu.be' && path.length > 1) {
    // Keep share links for user-selected live broadcasts; don't change which
    // content they point to. All query parameters remain on the page link.
  } else if (!(/^\/live\/[^/]+/.test(path) ||
               (path === '/watch' && !!url.searchParams.get('v')) ||
               /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/live\/?$/.test(path))) {
    throw new Error('Choose a YouTube video, live broadcast, or channel /live link.');
  }
  url.hash = '';
  return url.toString();
}

export function recordYouTubeLink(
  recent: readonly YouTubeLiveLink[], input: string, openedAt: number
): YouTubeLiveLink[] {
  const url = normalizeYouTubeLiveUrl(input);
  return [{ url, openedAt }, ...recent.filter(item => item.url !== url)]
    .slice(0, YOUTUBE_HISTORY_LIMIT);
}

export function parseYouTubeHistory(raw: string | null): YouTubeLiveLink[] {
  if (!raw) return [];
  try {
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    const unique = new Set<string>();
    const result: YouTubeLiveLink[] = [];
    for (const item of items.slice(0, 24)) {
      if (!item || typeof item !== 'object' || !('url' in item) ||
          !('openedAt' in item) || typeof item.url !== 'string' ||
          typeof item.openedAt !== 'number' || !Number.isFinite(item.openedAt)) continue;
      try {
        const url = normalizeYouTubeLiveUrl(item.url);
        if (unique.has(url)) continue;
        unique.add(url);
        result.push({ url, openedAt: item.openedAt });
      } catch { /* ignore stale or unsafe saved links */ }
      if (result.length === YOUTUBE_HISTORY_LIMIT) break;
    }
    return result;
  } catch { return []; }
}

export function youtubeHistoryStorageKey(owner: string): string {
  return 'visionguard:youtube-recent:v1:' + owner;
}

export function youtubeLinkLabel(input: string): string {
  const url = new URL(normalizeYouTubeLiveUrl(input));
  if (url.hostname === 'youtu.be') return 'YouTube · ' + url.pathname.slice(1, 23);
  if (url.pathname.startsWith('/live/')) return 'YouTube Live · ' + url.pathname.split('/')[2].slice(0, 22);
  if (url.pathname === '/watch') return 'YouTube · ' + (url.searchParams.get('v') || '').slice(0, 22);
  return 'YouTube · ' + url.pathname.replace(/^\//, '').slice(0, 35);
}
