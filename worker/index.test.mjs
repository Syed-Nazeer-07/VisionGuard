import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { modelResponse, MODEL_ROUTE, MODEL_UPSTREAM } from './index.mjs';

const address = 'https://visionguard.example.workers.dev' + MODEL_ROUTE;
test('streams binary model GET through one fixed Hugging Face /resolve destination', async () => {
  let captured;
  const stream = new ReadableStream({
    start(ctrl) { ctrl.enqueue(new Uint8Array([8, 1, 2, 3])); ctrl.close(); }
  });
  const result = await modelResponse(new Request(address), async (uri, options) => {
    captured = { uri, options };
    return new Response(stream, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
  });
  assert.equal(captured.uri, MODEL_UPSTREAM);
  assert.equal(captured.options.method, 'GET');
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(result.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [8, 1, 2, 3]);
});
test('HEAD validates the model without streaming a body', async () => {
  const result = await modelResponse(new Request(address, { method: 'HEAD' }),
    async (_url, options) => {
      assert.equal(options.method, 'HEAD');
      return new Response(null, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    });
  assert.equal(result.status, 200);
  assert.equal(result.body, null);
});
test('rejects user-controlled model URLs and unsupported methods', async () => {
  let attempted = false;
  const neverFetch = async () => { attempted = true; throw Error('Must not fetch'); };
  assert.equal((await modelResponse(new Request(address + '?url=https://evil.test/m'), neverFetch)).status, 400);
  assert.equal((await modelResponse(new Request(address, {method: 'POST'}), neverFetch)).status, 405);
  assert.equal(attempted, false);
});
test('does not return misleading success for a Hugging Face HTML page or missing model', async () => {
  const html = await modelResponse(new Request(address), async () =>
    new Response('<html>viewer</html>', { headers: {'content-type': 'text/html'} }));
  assert.equal(html.status, 502);
  const missing = await modelResponse(new Request(address), async () =>
    new Response(null, {status: 404}));
  assert.equal(missing.status, 502);
  const offline = await modelResponse(new Request(address), async () => { throw Error('network'); });
  assert.equal(offline.status, 502);
});
test('unrelated routes continue to serve the original Vite single-page application', async () => {
  const request = new Request('https://visionguard.example.workers.dev/login');
  const result = await worker.fetch(request, { ASSETS: {
    fetch(incoming) { assert.equal(incoming, request); return new Response('ok'); }
  } });
  assert.equal(await result.text(), 'ok');
});
