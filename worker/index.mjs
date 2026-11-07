/**
 * Same-origin, streaming proxy for VisionGuard's explicitly permitted public
 * YOLO11s ONNX file. Hugging Face's /blob view is HTML, and /resolve redirects
 * can be blocked by browser CORS. A Worker fetch avoids browser CORS and uses
 * no R2 subscription, credentials, or unbounded user-supplied URLs.
 */
export const MODEL_ROUTE = '/api/model/yolo11s.onnx';
export const MODEL_UPSTREAM =
  'https://huggingface.co/SyedNazeer07/visionguard-yolo11s/resolve/main/yolo11s.onnx';

const errorHeaders = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

/**
 * Proxies binary GET and HEAD only; upstream bodies are streamed, never
 * buffered (the model is ~38 MB). The target cannot be changed by callers.
 */
export async function modelResponse(request, upstreamFetch = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== MODEL_ROUTE) return null;
  if (url.search) {
    return new Response('Model URL does not accept query parameters.', {
      status: 400, headers: errorHeaders,
    });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Only GET and HEAD are supported.', {
      status: 405, headers: { ...errorHeaders, allow: 'GET, HEAD' },
    });
  }

  let upstream;
  try {
    upstream = await upstreamFetch(MODEL_UPSTREAM, {
      method: request.method, redirect: 'follow',
      headers: { accept: 'application/octet-stream' },
    });
  } catch {
    return new Response('Public Hugging Face YOLO11s model is temporarily unreachable.', {
      status: 502, headers: errorHeaders,
    });
  }
  if (!upstream.ok) {
    return new Response('Public YOLO11s model download failed (upstream HTTP ' +
      upstream.status + ').', { status: 502, headers: errorHeaders });
  }

  const type = (upstream.headers.get('content-type') || '').toLowerCase();
  if (type.includes('text/html') || type.includes('application/json')) {
    return new Response('Hugging Face returned an HTML/JSON page instead of ONNX data.', {
      status: 502, headers: errorHeaders,
    });
  }

  const headers = new Headers({
    'content-type': 'application/octet-stream',
    'cache-control': 'public, max-age=3600',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  });
  for (const header of ['etag', 'last-modified']) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: 200, headers,
  });
}

export default {
  async fetch(request, env) {
    const model = await modelResponse(request);
    if (model) return model;
    return env.ASSETS.fetch(request);
  },
};
