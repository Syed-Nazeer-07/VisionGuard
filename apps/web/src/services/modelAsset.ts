import { readCachedModel, writeCachedModel, type ModelCacheStorageLike } from './modelCache';

/**
 * Fetch an ONNX model once with observable download progress. Do not issue a
 * separate HEAD or byte-range probe: some model hosts reject them, and model
 * weight downloads should not be duplicated by runtime initialization.
 */
export type ModelProgress = (receivedBytes: number, totalBytes: number | null) => void;
const MAX_MODEL_BYTES = 128 * 1024 * 1024;

export async function downloadModelAsset(
  path: string,
  fetcher: typeof fetch = fetch,
  onProgress?: ModelProgress,
  onCacheHit?: (modelBytes: number) => void,
  cacheStorage: ModelCacheStorageLike | null = typeof caches !== 'undefined' ? caches : null,
): Promise<Uint8Array<ArrayBuffer>> {
  const cached = await readCachedModel(path, cacheStorage);
  if (cached) {
    onCacheHit?.(cached.byteLength);
    return cached;
  }
  let response: Response;
  try {
    response = await fetcher(path, { credentials: 'omit', mode: 'cors' });
  } catch (cause) {
    throw new Error('Could not download the ONNX model. Check your connection and the model URL/CORS settings.', { cause });
  }
  if (!response.ok || response.status === 206) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Model download failed (HTTP ' + response.status + '). Check the configured ONNX URL.');
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    void response.body?.cancel().catch(() => {});
    throw new Error('The model URL returned a web page or API response instead of ONNX weights.');
  }

  const sizeHeader = Number(response.headers.get('content-length'));
  const total = Number.isFinite(sizeHeader) && sizeHeader > 0 ? sizeHeader : null;
  if (total !== null && total > MAX_MODEL_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new Error('ONNX response exceeds the supported maximum size.');
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    if (!response.body) {
      bytes = new Uint8Array(await response.arrayBuffer());
      onProgress?.(bytes.byteLength, total);
    } else {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          received += value.byteLength;
          if (received > MAX_MODEL_BYTES) {
            void reader.cancel().catch(() => {});
            throw new Error('ONNX response exceeds the supported maximum size.');
          }
          chunks.push(value);
          onProgress?.(received, total);
        }
      } finally {
        reader.releaseLock();
      }
      bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('maximum size')) throw cause;
    throw new Error('The ONNX model download was interrupted. Check connectivity and retry.', { cause });
  }
  const header = new TextDecoder().decode(bytes.subarray(0, 80)).trimStart();
  if (bytes.length < 1024 || header.startsWith('<') || header.startsWith('{')) {
    throw new Error('The model download is incomplete or is not an ONNX binary.');
  }
  // Save once per browser/model version, not once per uploaded video. Cache
  // writes may fail (private browsing/storage quota) without blocking YOLO.
  await writeCachedModel(path, bytes, cacheStorage);
  return bytes;
}
