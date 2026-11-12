import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'apps/web/src');
const read = relative => readFileSync(path.join(root, relative), 'utf8');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full)
      : /\.(?:ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

test('one browser inference engine: no FastAPI server directory or legacy API client', () => {
  for (const item of [
    'backend', 'apps/web/src/pages/Analyze.tsx',
    'apps/web/src/pages/LocalAnalyze.tsx',
    'apps/web/src/services/backendAnalysis.ts',
    'apps/web/src/services/stream.ts'
  ]) {
    assert.equal(existsSync(path.join(root, item)), false, item + ' should not be shipped');
  }
  const config = read('apps/web/.env.example');
  assert.doesNotMatch(config, /VITE_(?:ANALYSIS_API|STREAM_API)_URL/);
});

test('browser source code does not call the retired localhost API', () => {
  for (const file of walk(web)) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /(?:127\.0\.0\.1|localhost):8000|\/api\/v1\/analysis\/jobs/,
      path.relative(root, file));
    assert.doesNotMatch(content, /(?:import|from)\s*['"][^'"]*backendAnalysis['"]/,
      path.relative(root, file));
    assert.doesNotMatch(content, /VITE_(?:ANALYSIS_API|STREAM_API)_URL/,
      path.relative(root, file));
  }
});

test('modern analysis and saved historical reviews remain routed', () => {
  const app = read('apps/web/src/App.tsx');
  const layout = read('apps/web/src/components/layout/AppLayout.tsx');
  const videoReview = read('apps/web/src/pages/VideoReview.tsx');
  assert.match(layout, /RealtimeAnalyze/);
  assert.match(app, /path="analyze"/);
  assert.match(app, /path="archive-videos"/);
  assert.match(videoReview, /legacyAnalysisArtifacts/);
});
