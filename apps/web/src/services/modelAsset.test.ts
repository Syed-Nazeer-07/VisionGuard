import { describe, expect, it, vi } from 'vitest';
import { downloadModelAsset } from './modelAsset';

const model = '/models/yolo11s.onnx';

describe('detector model download', () => {
  it('reads the binary with one public GET and browser caching', async () => {
    const bytes = new Uint8Array(2048).fill(8);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes));
    await expect(downloadModelAsset(model, fetcher)).resolves.toEqual(bytes);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(model, { credentials: 'omit', mode: 'cors' });
  });

  it.each([404, 503, 206])('surfaces HTTP %s rather than initializing the runtime', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    await expect(downloadModelAsset(model, fetcher)).rejects.toThrow('HTTP ' + status);
  });

  it('rejects SPA HTML and structured API errors even with generic content headers', async () => {
    for (const prefix of ['<!doctype html>', '{"error":']) {
      await expect(downloadModelAsset(model, async () => new Response(prefix + ' '.repeat(2048))))
        .rejects.toThrow('not an ONNX binary');
    }
    await expect(downloadModelAsset(model, async () => Response.json({ error: 'missing' })))
      .rejects.toThrow('API response');
  });

  it('distinguishes connectivity failures and interrupted response bodies', async () => {
    await expect(downloadModelAsset(model, async () => { throw new TypeError('network'); }))
      .rejects.toThrow('connection');
    const body = new ReadableStream({ start(controller) { controller.error(new Error('disconnect')); } });
    await expect(downloadModelAsset(model, async () => new Response(body))).rejects.toThrow('interrupted');
  });
});
