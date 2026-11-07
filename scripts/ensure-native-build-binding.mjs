/**
 * Repair npm's missing Linux native optional packages for Rolldown & Oxlint.
 * Run once before Cloudflare's Vite build, without changing tracked lockfiles.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));

export function bindingForPlatform(platform, arch, glibcVersion) {
  if (platform !== 'linux') return null;
  if (arch !== 'x64' && arch !== 'arm64') return null;
  return '@rolldown/binding-linux-' + arch + '-' + (glibcVersion ? 'gnu' : 'musl');
}
function installedVersion(pkg, rootDir = root) {
  for (const relative of [
    'apps/web/node_modules/' + pkg + '/package.json',
    'node_modules/' + pkg + '/package.json',
  ]) {
    const file = path.join(rootDir, relative);
    if (!existsSync(file)) continue;
    const version = JSON.parse(readFileSync(file, 'utf8')).version;
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error('Unexpected installed ' + pkg + ' version: ' + version);
    }
    return version;
  }
  throw new Error(pkg + ' is not installed. The hosting platform must run npm ci first.');
}
export function installedRolldownVersion(rootDir = root) {
  return installedVersion('rolldown', rootDir);
}
export function installedOxlintVersion(rootDir = root) {
  return installedVersion('oxlint', rootDir);
}
export function ensureCloudflareBuildBinding() {
  const glibc = process.report?.getReport()?.header?.glibcVersionRuntime;
  const rolldownBinding = bindingForPlatform(process.platform, process.arch, glibc);
  if (!rolldownBinding) {
    console.log('[build] Non-Linux platform: npm manages native bindings.');
    return;
  }
  const binaries = [
    [rolldownBinding, installedRolldownVersion()],
    [rolldownBinding.replace('@rolldown/', '@oxlint/'), installedOxlintVersion()],
  ];
  const missing = binaries.filter(([name, version]) => {
    try {
      webRequire(name);
      console.log('[build] Binding available:', name, version);
      return false;
    } catch {
      console.warn('[build] Binding missing:', name, version);
      return true;
    }
  });
  if (!missing.length) return;

  // One npm install for both missing binaries. Two sequential --no-save
  // installs can prune each other's previously installed transient package.
  const result = spawnSync('npm', [
    'install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund',
    '--ignore-scripts', ...missing.map(([name, version]) => name + '@' + version),
  ], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error('Native binding install failed. ' +
      String(result.error ?? ('npm exit code ' + result.status)));
  }
  for (const [name, version] of binaries) {
    try { webRequire(name); }
    catch (error) {
      throw new Error('Installed ' + name + ' cannot be loaded: ' +
        (error instanceof Error ? error.message : String(error)));
    }
    console.log('[build] Binding verified:', name, version);
  }
}
if (process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { ensureCloudflareBuildBinding(); }
  catch (error) {
    console.error('[build] Native dependency repair failed:', error);
    process.exitCode = 1;
  }
}
