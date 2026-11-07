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
function fixture(version = '1.30.0', runtimeVersion = version) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vg-ort-'));
  roots.push(root);
  const web = path.join(root, 'apps/web');
  for (const rel of ['node_modules/onnxruntime-web', 'src/services', 'dist/assets']) {
    mkdirSync(path.join(web, rel), { recursive: true });
  }
  writeFileSync(path.join(web, 'node_modules/onnxruntime-web/package.json'),
    JSON.stringify({ version }));
  writeFileSync(path.join(web, 'src/services/ortWasmPaths.ts'),
    "export const ORT_WASM_CDN_VERSION = '" + runtimeVersion + "';");
  writeFileSync(path.join(web, 'dist/assets/localTrafficWorker-TEST.js'),
    'const url="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";');
  writeFileSync(path.join(web, 'dist/assets/ort-wasm-simd-threaded.jsep-abc123.wasm'), 'wasm');
  writeFileSync(path.join(web, 'dist/assets/another.wasm'), 'another');
  return root;
}
test('removes only redundant JSEP WASM, preserving other assets', () => {
  const root = fixture();
  const result = prepareCloudflareAssets(root);
  assert.equal(result.length, 1);
  assert.equal(result[0].file, 'ort-wasm-simd-threaded.jsep-abc123.wasm');
  assert.equal(existsSync(path.join(root, 'apps/web/dist/assets/another.wasm')), true);
});
test('rejects mismatch between the installed and CDN runtime versions', () => {
  assert.throws(() => prepareCloudflareAssets(fixture('1.30.1')), /does not match/);
  assert.throws(() => prepareCloudflareAssets(fixture('1.30.0', '1.30.2')), /versions differ/);
});
test('rejects production assets lacking external CDN configuration', () => {
  const root = fixture();
  writeFileSync(path.join(root, 'apps/web/dist/assets/localTrafficWorker-TEST.js'), 'offline only');
  assert.throws(() => prepareCloudflareAssets(root), /does not configure/);
});
