import { describe, expect, it, vi } from 'vitest';
import { downloadModelAsset } from './modelAsset';
import {
  canCachePublicModelPath, MODEL_CACHE_NAME, MODEL_CACHE_TTL_MS,
  readCachedModel, writeCachedModel,
  type ModelCacheLike, type ModelCacheStorageLike,
} from './modelCache';

class FakeCache {
  private entries = new Map<string, Response>();

  async match(path: string): Promise<Response | undefined> {
    return this.entries.get(path)?.clone();
  }

  async put(path: string, response: Response): Promise<void> {
    this.entries.set(path, response.clone());
  }

  async delete(path: string): Promise<boolean> {
    return this.entries.delete(path);
  }
}

function fixture() {
  const cache = new FakeCache();
  const open = vi.fn(async (_name: string): Promise<ModelCacheLike> => cache);
  const store: ModelCacheStorageLike = { open };
  return { cache, store, open };
}

const path = '/api/model/yolo11s.onnx';
const weights = new Uint8Array(2048).fill(8);

describe('persistent YOLO model caching', () => {
  it('fetches weights only once across fresh detector sessions', async () => {
    const { store, open } = fixture();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(weights));
    const first = await downloadModelAsset(path, fetcher, undefined, undefined, store);
    const onCacheHit = vi.fn();
    const second = await downloadModelAsset(path, fetcher, undefined, onCacheHit, store);

    expect(first).toEqual(weights);
    expect(second).toEqual(weights);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onCacheHit).toHaveBeenCalledExactlyOnceWith(weights.byteLength);
    expect(open).toHaveBeenCalledWith(MODEL_CACHE_NAME);
  });

  it('expires stale models and redownloads without serving an outdated cache entry', async () => {
    const { store } = fixture();
    await writeCachedModel(path, weights, store, Date.now() - MODEL_CACHE_TTL_MS - 1000);
    expect(await readCachedModel(path, store)).toBeNull();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(weights));
    await downloadModelAsset(path, fetcher, undefined, undefined, store);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects corrupt cached bytes and falls back to downloading', async () => {
    const { cache, store } = fixture();
    await cache.put(path, new Response(new Uint8Array(8), {
      headers: { 'x-visionguard-cached-at': String(Date.now()) },
    }));
    const fetcher = vi.fn<typeof fetch>(async () => new Response(weights));
    expect(await downloadModelAsset(path, fetcher, undefined, undefined, store)).toEqual(weights);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not persist arbitrary external or signed model URLs', async () => {
    const { store, open } = fixture();
    for (const invalid of [
      'https://example.com/weights.onnx',
      '//example.com/weights.onnx',
      '/api/model/yolo11s.onnx?token=secret',
      '/api/model/yolo11s.onnx#fragment',
    ]) {
      expect(canCachePublicModelPath(invalid)).toBe(false);
      await writeCachedModel(invalid, weights, store);
      expect(await readCachedModel(invalid, store)).toBeNull();
    }
    expect(canCachePublicModelPath(path)).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('still loads over network when private mode disables cache storage', async () => {
    const disabled: ModelCacheStorageLike = {
      open: async () => { throw new Error('storage disabled'); },
    };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(weights));
    expect(await downloadModelAsset(path, fetcher, undefined, undefined, disabled)).toEqual(weights);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never stores failed or partial ONNX responses', async () => {
    const { store } = fixture();
    const network = vi.fn<typeof fetch>(async () => new Response('<html>' + ' '.repeat(2048)));
    await expect(downloadModelAsset(path, network, undefined, undefined, store)).rejects.toThrow('not an ONNX binary');
    expect(await readCachedModel(path, store)).toBeNull();
  });
});
