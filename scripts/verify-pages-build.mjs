/**
 * Build-time guard for Cloudflare Pages. A green Vite build alone can publish a
 * demo with no real Supabase login or no YOLO11s model. Fail that deployment.
 * This script checks configuration and static asset packaging, not live remote
 * service availability or model quality.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const PAGES_MAX_FILES_FREE = 20_000;

function isRealPublicKey(key) {
  return Boolean(key && key.length >= 12 &&
    !/(placeholder|your[_-]|your-|replace|example|<|>)/i.test(key) &&
    !key.startsWith('sb_secret_') && !key.startsWith('sb_service_role_'));
}

function isValidPublicModelUrl(source) {
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && Boolean(url.hostname) &&
      !url.username && !url.password && !url.search && !url.hash &&
      url.pathname.toLowerCase().endsWith('.onnx') &&
      !/\.invalid$|\.example$/.test(url.hostname);
  } catch {
    return false;
  }
}

export function inspectPagesBuild({ rootDir = process.cwd(), env = process.env } = {}) {
  const dist = path.join(rootDir, 'apps', 'web', 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) {
    throw new Error('Missing apps/web/dist/index.html. Run npm run build first.');
  }
  if (!existsSync(path.join(dist, '_headers'))) {
    throw new Error('The security headers file did not make it into apps/web/dist.');
  }

  const api = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!api || !isRealPublicKey(key)) {
    throw new Error('Pages must be configured with the PUBLIC VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_ANON_KEY. Refusing to deploy the seeded demo adapter.');
  }
  let apiUrl;
  try { apiUrl = new URL(api); } catch { /* handled below */ }
  if (!apiUrl || apiUrl.protocol !== 'https:' || !apiUrl.hostname ||
      apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash ||
      /(your-project|placeholder|example\.com|\.invalid$)/i.test(apiUrl.hostname)) {
    throw new Error('VITE_SUPABASE_URL must be the real HTTPS URL for your Supabase project.');
  }

  const configuredModelUrl = env.VITE_YOLO_MODEL_URL?.trim() ?? '';
  if (configuredModelUrl && !isValidPublicModelUrl(configuredModelUrl)) {
    throw new Error('VITE_YOLO_MODEL_URL must be an HTTPS link ending in .onnx ' +
      'without credentials, query tokens or fragments. Do not expose signed video URLs.');
  }

  let files = 0;
  function inspect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const item = path.join(dir, entry.name);
      if (entry.isDirectory()) { inspect(item); continue; }
      if (!entry.isFile()) continue;
      files++;
      const size = statSync(item).size;
      if (size > PAGES_MAX_FILE_BYTES) {
        throw new Error('Cloudflare Pages rejects files over 25 MiB: ' +
          path.relative(dist, item) + '. Host the model via public R2/custom CDN.');
      }
    }
  }
  inspect(dist);
  if (files > PAGES_MAX_FILES_FREE) {
    throw new Error('Cloudflare Pages Free accepts at most 20,000 static files.');
  }

  const localModel = path.join(dist, 'models', 'yolo11s.onnx');
  if (!configuredModelUrl && !existsSync(localModel)) {
    throw new Error('No deployable YOLO11s model found. Set VITE_YOLO_MODEL_URL to ' +
      'a PUBLIC HTTPS model endpoint (R2/CDN), or package a model <=25 MiB at ' +
      'apps/web/public/models/yolo11s.onnx before building.');
  }
  return { staticFiles: files, model: configuredModelUrl ? 'external HTTPS' : 'bundled local' };
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = inspectPagesBuild();
    console.log('Cloudflare Pages package validated:', result.staticFiles,
      'static assets; model:', result.model,
      '; public authentication configuration provided.');
    console.log('Remote model reachability, OAuth, R2 CORS and B2 signing still require live tests.');
  } catch (error) {
    console.error('Cloudflare Pages deployment rejected:', error.message);
    process.exitCode = 1;
  }
}
