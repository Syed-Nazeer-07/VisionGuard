/** Public GoTrue settings never expose client secrets. A failed preflight is
 * intentionally inconclusive; only an explicit disabled provider blocks OAuth. */
export function googleProviderStatus(value: unknown): 'enabled' | 'disabled' | 'unknown' {
  if (!value || typeof value !== 'object') return 'unknown';
  const external = (value as { external?: unknown }).external;
  if (!external || typeof external !== 'object') return 'unknown';
  const google = (external as { google?: unknown }).google;
  return google === true ? 'enabled' : google === false ? 'disabled' : 'unknown';
}

export async function checkGoogleProvider(url: string, publicKey: string): Promise<'enabled' | 'disabled' | 'unknown'> {
  if (!url || !publicKey) return 'unknown';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url.replace(/\/+$/, '') + '/auth/v1/settings', {
      method: 'GET', headers: { apikey: publicKey },
      signal: controller.signal, cache: 'no-store'
    });
    if (!response.ok) return 'unknown';
    return googleProviderStatus(await response.json());
  } catch {
    // Browser CORS/network policy may block this public endpoint. In that
    // case attempt the normal Supabase OAuth flow instead of disabling login.
    return 'unknown';
  } finally {
    clearTimeout(timeout);
  }
}
