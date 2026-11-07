/** Accept only ordinary public webpages for the user's own browser tab. */
export function normalizeVideoPageUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Paste a YouTube Live or traffic-camera page URL.');
  if (trimmed.length > 2048) throw new Error('The URL is too long.');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a complete link starting with https://');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTPS or HTTP web pages can be opened.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Do not include passwords or private camera credentials in a link.');
  }
  if (!parsed.hostname) throw new Error('Enter a valid website hostname.');
  return parsed.toString();
}
