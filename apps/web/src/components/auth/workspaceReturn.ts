/** Retain requested workspace deep links without accepting arbitrary redirects. */
export function workspaceReturn(location: unknown): string {
  if (!location || typeof location !== 'object' || !('pathname' in location)) return '/app';
  const { pathname } = location;
  if (typeof pathname !== 'string' || !/^\/app(?:\/[^?#\\]*)?$/.test(pathname)) return '/app';
  const search = 'search' in location && typeof location.search === 'string' &&
    location.search.startsWith('?') ? location.search : '';
  const hash = 'hash' in location && typeof location.hash === 'string' &&
    location.hash.startsWith('#') ? location.hash : '';
  const target = new URL(pathname + search + hash, 'https://visionguard.invalid');
  if (target.pathname !== '/app' && !target.pathname.startsWith('/app/')) return '/app';
  return target.pathname + target.search + target.hash;
}
