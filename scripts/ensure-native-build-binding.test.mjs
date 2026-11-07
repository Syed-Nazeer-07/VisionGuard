import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bindingForPlatform, installedRolldownVersion } from './ensure-native-build-binding.mjs';

test('selects the Cloudflare Linux x64 glibc native package', () => {
  assert.equal(bindingForPlatform('linux', 'x64', '2.36'),
    '@rolldown/binding-linux-x64-gnu');
});
test('supports Linux arm64 and musl without assuming Cloudflare everywhere', () => {
  assert.equal(bindingForPlatform('linux', 'arm64', '2.35'),
    '@rolldown/binding-linux-arm64-gnu');
  assert.equal(bindingForPlatform('linux', 'x64', undefined),
    '@rolldown/binding-linux-x64-musl');
  assert.equal(bindingForPlatform('win32', 'x64', undefined), null);
  assert.equal(bindingForPlatform('darwin', 'arm64', undefined), null);
});
const roots = [];
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(version) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vg-binding-'));
  roots.push(root);
  const directory = path.join(root, 'apps/web/node_modules/rolldown');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version }));
  return root;
}
test('pins the native package to the exact installed Rolldown version', () => {
  assert.equal(installedRolldownVersion(fixture('1.2.12')), '1.2.12');
  assert.equal(installedRolldownVersion(fixture('1.3.0-rc.1')), '1.3.0-rc.1');
});
test('fails closed on invalid package metadata and uninstalled Rolldown', () => {
  assert.throws(() => installedRolldownVersion(fixture('$(bad)')), /Unexpected installed Rolldown/);
  const root = mkdtempSync(path.join(os.tmpdir(), 'vg-binding-missing-'));
  roots.push(root);
  assert.throws(() => installedRolldownVersion(root), /npm ci/);
});
