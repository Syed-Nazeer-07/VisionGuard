/**
 * Persistent cache for the public, same-origin YOLO model. Cache Storage is
 * available in dedicated workers on supported browsers and survives page
 * navigation. Browsers may evict this cache at any time; network fallback is
 * always required. Version the namespace when changing the model weights.
 *
 * Avoid persisting arbitrary third-party or signed model URLs, since their
 * query strings may contain secrets or expire.
 */
export const MODEL_CACHE_NAME = 'visionguard-onnx-weights-v1';
export const MODEL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MODEL_BYTES = 128 * 1024 * 1024;

export type ModelCacheLike = Pick<Cache, 'match' | 'put' | 'delete'>;
export type ModelCacheStorageLike = { open(name: string): Promise<ModelCacheLike> };

export function canCachePublicModelPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') &&
    !path.includes('?') && !path.includes('#');
}

function recognizableModel(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 1024 || bytes.byteLength > MAX_MODEL_BYTES) return false;
  const first = new TextDecoder().decode(bytes.subarray(0, 80)).trimStart();
  return !first.startsWith('<') && !first.startsWith('{');
}

export async function readCachedModel(
  path: string,
  store: ModelCacheStorageLike | null,
  now = Date.now(),
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!store || !canCachePublicModelPath(path)) return null;
  try {
    const cache = await store.open(MODEL_CACHE_NAME);
    const response = await cache.match(path);
    if (!response) return null;
    const storedAt = Number(response.headers.get('x-visionguard-cached-at'));
    // Discard unverifiable/expired entries; this cache is not authoritative.
    if (!Number.isFinite(storedAt) || storedAt <= 0 ||
        now < storedAt || now - storedAt >= MODEL_CACHE_TTL_MS) {
      await cache.delete(path);
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!recognizableModel(bytes)) {
      await cache.delete(path);
      return null;
    }
    return bytes;
  } catch {
    // Quota restrictions, private browsing, or disabled storage must never
    // prevent an otherwise working network model download.
    return null;
  }
}

export async function writeCachedModel(
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
  store: ModelCacheStorageLike | null,
  now = Date.now(),
): Promise<void> {
  if (!store || !canCachePublicModelPath(path) || !recognizableModel(bytes)) return;
  try {
    const cache = await store.open(MODEL_CACHE_NAME);
    await cache.put(path, new Response(bytes, {
      headers: {
        'content-type': 'application/octet-stream',
        'x-visionguard-cached-at': String(now),
      },
    }));
  } catch {
    // Storage is an optimization; an offline/in-memory model still works.
  }
}
