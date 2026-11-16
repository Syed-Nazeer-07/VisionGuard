import { describe, expect, it, vi } from 'vitest';
import { verifyOnnxModelUrl, type ModelFetcher } from './modelProbe';

const model = 'https://models.example.org/traffic.onnx';
const binary = (status = 200) =>
  new Response(new Uint8Array([8, 1, 2, 3]), {
    status, headers: { 'content-type': 'application/octet-stream' }
  });

describe('model URL availability probe', () => {
  it('uses only HEAD when a binary model is available', async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 200, headers: { 'content-type': 'application/octet-stream' }
    }));
    await expect(verifyOnnxModelUrl(model, fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(model, { method: 'HEAD', mode: 'cors' });
  });

  it('falls back to a bounded GET when HEAD is not allowed', async () => {
    let cancelled = false;
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => init.method === 'HEAD'
      ? new Response(null, { status: 405 })
      : new Response(new ReadableStream({
          start(controller) { controller.enqueue(new Uint8Array([8, 1, 2, 3])); },
          cancel() { cancelled = true; }
        }), { status: 206, headers: { 'content-type': 'application/octet-stream' } }));
    await expect(verifyOnnxModelUrl(model, fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(model, {
      method: 'GET', mode: 'cors', headers: { Range: 'bytes=0-31' }
    });
    expect(cancelled).toBe(true);
  });

  it('recovers when only cross-origin HEAD is blocked', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'HEAD') throw new TypeError('Failed to fetch');
      return binary();
    });
    await expect(verifyOnnxModelUrl(model, fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects an HTML SPA fallback even with status 200', async () => {
    const fetcher: ModelFetcher = async () => new Response('<html>app shell</html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
    await expect(verifyOnnxModelUrl(model, fetcher)).rejects.toThrow('HTML page');
  });

  it('reports missing models without unnecessary GET requests', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(verifyOnnxModelUrl(model, fetcher)).rejects.toThrow('HTTP 404');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects an HTML body returned by the GET fallback', async () => {
    const fetcher: ModelFetcher = async (_url, init) =>
      init.method === 'HEAD' ? new Response(null, { status: 405 }) :
        new Response('<html>app</html>', { headers: { 'content-type': 'text/html' } });
    await expect(verifyOnnxModelUrl(model, fetcher)).rejects.toThrow('HTML page');
  });

  it('returns actionable errors when GET is also blocked', async () => {
    const fetcher: ModelFetcher = async () => { throw new TypeError('Failed to fetch'); };
    await expect(verifyOnnxModelUrl(model, fetcher)).rejects.toThrow('GET/CORS permissions');
  });
});
