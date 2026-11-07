import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { prepareCloudflareAssets } from './prepare-cloudflare-assets.mjs';

const roots = [];
afterEach(() => {
  for (const x of roots.splice(0)) rmSync(x, { force: true, recursive: true });
});
function fixture(installedVersion = '1.30.0', emittedVersion = installedVersion) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vg-ort-'));
  roots.push(root);
  const web = path.join(root, 'apps/web');
  for (const rel of ['node_modules/onnxruntime-web', 'src/services', 'dist/assets']) {
    mkdirSync(path.join(web, rel), { recursive: true });
  }
  writeFileSync(path.join(web, 'node_modules/onnxruntime-web/package.json'),
    JSON.stringify({ version: installedVersion }));
  writeFileSync(path.join(web, 'src/services/ortWasmPaths.ts'),
    'export const ORT_WASM_CDN_BASE = __ORT_WASM_CDN_BASE__;');
  writeFileSync(path.join(web, 'dist/assets/localTrafficWorker-TEST.js'),
    'const url="https://cdn.jsdelivr.net/npm/onnxruntime-web@' + emittedVersion + '/dist/";');
  writeFileSync(path.join(web, 'dist/assets/ort-wasm-simd-threaded.jsep-abc123.wasm'), 'wasm');
  writeFileSync(path.join(web, 'dist/assets/another.wasm'), 'another');
  return root;
}
test('removes only duplicated JSEP WASM, preserving other assets', () => {
  const root = fixture();
  const result = prepareCloudflareAssets(root);
  assert.equal(result.length, 1);
  assert.equal(result[0].file, 'ort-wasm-simd-threaded.jsep-abc123.wasm');
  assert.equal(existsSync(path.join(root, 'apps/web/dist/assets/another.wasm')), true);
});
test('accepts the exact installed ORT version even if npm upgraded it', () => {
  const root = fixture('1.31.1');
  assert.equal(prepareCloudflareAssets(root).length, 1);
});
test('rejects an emitted CDN URL for a different ONNX Runtime build', () => {
  assert.throws(() => prepareCloudflareAssets(fixture('1.31.1', '1.30.0')), /lacks same-version/);
});
test('rejects production assets lacking the external CDN URL', () => {
  const root = fixture();
  writeFileSync(path.join(root, 'apps/web/dist/assets/localTrafficWorker-TEST.js'), 'offline only');
  assert.throws(() => prepareCloudflareAssets(root), /lacks same-version/);
});
