/**
 * Cloudflare Workers static assets max out at 25 MiB per file.
 * Vite eagerly emits ONNX Runtime Web's ~29.5 MiB JSEP WASM even when runtime
 * paths are overridden. Exclude ONLY that duplicate binary from production,
 * after checking that its exact-version CDN is configured in generated JS.
 */
import { existsSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ORT_CDN_VERSION = '1.30.0';
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
  if (version !== ORT_CDN_VERSION) {
    throw new Error('Installed ONNX Runtime ' + version + ' does not match pinned CDN version ' +
      ORT_CDN_VERSION + '. Both must match exactly.');
  }
  const settings = readFileSync(path.join(web, 'src/services/ortWasmPaths.ts'), 'utf8');
  if (!settings.includes("ORT_WASM_CDN_VERSION = '" + ORT_CDN_VERSION + "'")) {
    throw new Error('The runtime CDN and deploy-script versions differ.');
  }
  const assets = readdirSync(assetDir);
  const cdnConfigured = assets.filter(file => file.endsWith('.js'))
    .some(file => readFileSync(path.join(assetDir, file), 'utf8')
      .includes('cdn.jsdelivr.net/npm/onnxruntime-web@'));
  if (!cdnConfigured) {
    throw new Error('Built JS does not configure the public version-pinned ONNX Runtime CDN.');
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
      console.log('[deploy] Matching ONNX Runtime WASM from public CDN v' + ORT_CDN_VERSION +
        '; excluded Vite duplicate:', removed.file,
        '(' + (removed.bytes / 1024 / 1024).toFixed(1) + ' MiB)');
    }
  } catch (error) {
    console.error('[deploy] Cannot prepare Cloudflare assets:', error);
    process.exitCode = 1;
  }
}
