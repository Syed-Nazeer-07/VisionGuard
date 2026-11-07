/**
 * Cloudflare Workers static assets max out at 25 MiB per file.
 * Vite eagerly emits ONNX Runtime Web's ~29.5 MiB JSEP WASM even when runtime
 * paths are overridden. Exclude ONLY that duplicate binary from production,
 * after checking that its exact-version CDN is configured in generated JS.
 */
import { existsSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const JSEP_NAME = /^ort-wasm-simd-threaded\.jsep(?:-[A-Za-z0-9_-]+)?\.wasm$/;

export function prepareCloudflareAssets(rootDir = process.cwd()) {
  const web = path.join(rootDir, 'apps/web');
  const assetDir = path.join(web, 'dist/assets');
  const installed = [
    path.join(web, 'node_modules/onnxruntime-web/package.json'),
    path.join(rootDir, 'node_modules/onnxruntime-web/package.json'),
  ].find(file => existsSync(file));
  if (!installed) throw new Error('ONNX Runtime Web is missing; run npm ci.');
  const version = JSON.parse(readFileSync(installed, 'utf8')).version;
  const settings = readFileSync(path.join(web, 'src/services/ortWasmPaths.ts'), 'utf8');
  if (!settings.includes('ORT_WASM_CDN_BASE = __ORT_WASM_CDN_BASE__')) {
    throw new Error('Runtime source no longer uses Vite-injected ONNX CDN URL.');
  }
  const assets = readdirSync(assetDir);
  const requiredUrl = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + version + '/dist/';
  const cdnConfigured = assets.filter(file => file.endsWith('.js'))
    .some(file => readFileSync(path.join(assetDir, file), 'utf8').includes(requiredUrl));
  if (!cdnConfigured) {
    throw new Error('Built JS lacks same-version ONNX Runtime CDN (' + version +
      '). Verify the Vite define configuration and installed runtime version.');
  }
  const removed = [];
  for (const file of assets) {
    if (!JSEP_NAME.test(file)) continue;
    const target = path.join(assetDir, file);
    removed.push({ file, bytes: statSync(target).size });
    rmSync(target);
  }
  if (removed.length === 0) {
    throw new Error('Expected emitted JSEP WASM not found. Verify Vite asset loading before release.');
  }
  return removed;
}
if (process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    for (const removed of prepareCloudflareAssets()) {
      console.log('[deploy] Matching ONNX Runtime WASM from versioned public CDN' +
        '; excluded Vite duplicate:', removed.file,
        '(' + (removed.bytes / 1024 / 1024).toFixed(1) + ' MiB)');
    }
  } catch (error) {
    console.error('[deploy] Cannot prepare Cloudflare assets:', error);
    process.exitCode = 1;
  }
}
