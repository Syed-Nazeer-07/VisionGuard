import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, truncateSync } from 'node:fs';
import { inspectPagesBuild, PAGES_MAX_FILE_BYTES } from './verify-pages-build.mjs';

const roots = [];
function fixture() {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'vg-pages-'));
  roots.push(rootDir);
  const dist = path.join(rootDir, 'apps/web/dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<h1>App</h1>');
  writeFileSync(path.join(dist, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n');
  const env = {
    VITE_SUPABASE_URL: 'https://test-project.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'sb_publishable_some_public_value',
    VITE_YOLO_MODEL_URL: 'https://models.example.org/yolo11s.onnx',
  };
  return { rootDir, env, dist };
}
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test('passes a configured static Pages release with external ONNX weights', () => {
  const f = fixture();
  assert.equal(inspectPagesBuild(f).model, 'external HTTPS');
});
test('refuses demo deployment without real public Supabase configuration', () => {
  const f = fixture();
  assert.throws(() => inspectPagesBuild({ ...f, env: { ...f.env, VITE_SUPABASE_ANON_KEY: '' } }), /PUBLIC/);
  assert.throws(() => inspectPagesBuild({ ...f, env: { ...f.env, VITE_SUPABASE_URL: 'https://your-project.supabase.co' } }), /Supabase/);
});
test('rejects secret-like keys and model URLs containing private query tokens', () => {
  const f = fixture();
  assert.throws(() => inspectPagesBuild({ ...f, env: { ...f.env, VITE_SUPABASE_ANON_KEY: 'sb_secret_PRIVATE_KEY' } }), /PUBLIC/);
  assert.throws(() => inspectPagesBuild({ ...f, env: { ...f.env,
    VITE_YOLO_MODEL_URL: 'https://models.example.org/yolo11s.onnx?token=private' } }), /HTTPS/);
});
test('requires a model when an external model URL is absent', () => {
  const f = fixture();
  assert.throws(() => inspectPagesBuild({ ...f, env: { ...f.env, VITE_YOLO_MODEL_URL: '' } }), /No deployable YOLO11s/);
  mkdirSync(path.join(f.dist, 'models'), { recursive: true });
  writeFileSync(path.join(f.dist, 'models/yolo11s.onnx'), 'test');
  assert.equal(inspectPagesBuild({ ...f, env: { ...f.env, VITE_YOLO_MODEL_URL: '' } }).model, 'bundled local');
});
test('blocks oversized static files even when a remote model URL exists', () => {
  const f = fixture();
  const oversized = path.join(f.dist, 'oversized.wasm');
  writeFileSync(oversized, '');
  truncateSync(oversized, PAGES_MAX_FILE_BYTES + 1);
  assert.throws(() => inspectPagesBuild(f), /over 25 MiB/);
});
test('requires the Cloudflare response header rules in the output', () => {
  const f = fixture();
  rmSync(path.join(f.dist, '_headers'));
  assert.throws(() => inspectPagesBuild(f), /security headers/);
});
