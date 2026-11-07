/**
 * Cloudflare Workers Builds occasionally installs Rolldown without its
 * Linux native optional dependency (npm optional-dependency lockfile bug).
 * Repair exactly the binary matching the installed Rolldown version.
 *
 * This runs before Vite, only on Linux, and never modifies tracked manifests
 * or the package lock. Other platforms keep their npm-installed bindings.
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
  const abi = glibcVersion ? 'gnu' : 'musl';
  return `@rolldown/binding-linux-${arch}-${abi}`;
}

export function installedRolldownVersion(rootDir = root) {
  for (const relative of [
    'apps/web/node_modules/rolldown/package.json',
    'node_modules/rolldown/package.json',
  ]) {
    const file = path.join(rootDir, relative);
    if (!existsSync(file)) continue;
    const version = JSON.parse(readFileSync(file, 'utf8')).version;
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error('Unexpected installed Rolldown version: ' + version);
    }
    return version;
  }
  throw new Error('Rolldown is not installed. The hosting platform must run npm ci first.');
}

export function ensureCloudflareBuildBinding() {
  const glibcVersion = process.report?.getReport()?.header?.glibcVersionRuntime;
  const binding = bindingForPlatform(process.platform, process.arch, glibcVersion);
  if (!binding) {
    console.log('[build] Non-Linux or unsupported CPU: using npm platform bindings.');
    return;
  }
  const version = installedRolldownVersion();
  try {
    webRequire(binding);
    console.log('[build] Rolldown Linux native binding available:', binding, version);
    return;
  } catch {
    console.warn('[build] Rolldown Linux binding missing. Installing exact matching package:', binding, version);
  }

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, [
    'install', '--no-save', '--no-package-lock', '--no-audit',
    '--no-fund', '--ignore-scripts', `${binding}@${version}`,
  ], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error('Could not install Rolldown native binding for Cloudflare build. ' +
      String(result.error ?? `npm exit code ${result.status}`));
  }
  try {
    webRequire(binding);
  } catch (error) {
    throw new Error('npm installed Rolldown binding but it cannot be loaded: ' +
      (error instanceof Error ? error.message : String(error)));
  }
  console.log('[build] Rolldown binding verified:', binding, version);
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { ensureCloudflareBuildBinding(); }
  catch (error) {
    console.error('[build] Native dependency repair failed:', error);
    process.exitCode = 1;
  }
}
