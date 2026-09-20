import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const bundleName = /^[a-f0-9]{64}$/u;

function readLiveProcesses() {
  // Electron retains its bundle root in its inherited environment, even when
  // no bundle file is currently open. Keep this inventory in memory only.
  const marker = `redeven-bundle-inventory-${process.pid}`;
  const result = spawnSync('ps', ['axeww', '-o', 'pid=,command='], {
    encoding: 'utf8',
    env: { ...process.env, REDEVEN_DEV_BUNDLE_INVENTORY: marker },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10000,
  });
  if (result.error || result.status !== 0 || !result.stdout.includes(`REDEVEN_DEV_BUNDLE_INVENTORY=${marker}`)) {
    throw new Error('cannot inspect process arguments and environments; no development bundles were removed');
  }
  return result.stdout;
}

function directory(path) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info && (!info.isDirectory() || info.isSymbolicLink())) {
    throw new Error(`refusing a non-directory or symlink: ${path}`);
  }
  return info;
}

function verifiedBundle(path) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info?.isDirectory() || info.isSymbolicLink()) return null;
  const manifest = join(path, 'desktop-bundle-manifest.json');
  const manifestInfo = lstatSync(manifest, { throwIfNoEntry: false });
  if (!manifestInfo?.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 1024 * 1024) return null;
  const digest = createHash('sha256').update(readFileSync(manifest)).digest('hex');
  return path === join(dirname(path), digest) ? { path, modified: info.mtimeMs, device: info.dev, inode: info.ino } : null;
}

function makeDirectoriesWritable(path) {
  // Publication removes write permission recursively. Only directories need
  // it restored for unlink; never chmod files or follow package symlinks.
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) return;
  chmodSync(path, (info.mode & 0o777) | 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) makeDirectoriesWritable(join(path, entry.name));
  }
}

export function pruneDevelopmentBundles({ stateRoot, currentBundle, dryRun = false, readProcesses = readLiveProcesses }) {
  if (!stateRoot) throw new Error('a development state root is required');
  const root = realpathSync(stateRoot);
  const desktop = join(root, 'desktop');
  const bundlesRoot = join(desktop, 'bundles');
  const result = { candidates: [], removed: [], retained: 0, active: 0, ignored: 0 };
  if (!directory(desktop) || !directory(bundlesRoot)) return result;
  const current = currentBundle && verifiedBundle(resolve(currentBundle)) ? realpathSync(currentBundle) : undefined;
  if (currentBundle && (!current || dirname(current) !== bundlesRoot)) {
    throw new Error('current bundle must be a verified bundle in the selected development environment');
  }
  const bundles = [];
  for (const entry of readdirSync(bundlesRoot, { withFileTypes: true })) {
    const bundle = bundleName.test(entry.name) && entry.isDirectory()
      ? verifiedBundle(join(bundlesRoot, entry.name)) : null;
    if (bundle) bundles.push(bundle);
    else result.ignored++;
  }
  bundles.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
  const processes = readProcesses();
  for (const [index, bundle] of bundles.entries()) {
    // Match full bundle paths, including environment-only references. A
    // conservative extra retention is preferable to deleting a live package.
    const suppliedPath = join(resolve(stateRoot), 'desktop', 'bundles', basename(bundle.path));
    const active = processes.includes(bundle.path) || processes.includes(suppliedPath);
    if (active) result.active++;
    if (index < 3 || bundle.path === current || active) {
      result.retained++;
      continue;
    }
    result.candidates.push(bundle.path);
  }
  if (dryRun) return result;
  for (const path of result.candidates) {
    const original = bundles.find(bundle => bundle.path === path);
    const currentInfo = verifiedBundle(path);
    if (!currentInfo || currentInfo.device !== original.device || currentInfo.inode !== original.inode) {
      throw new Error(`development bundle changed during cleanup: ${path}`);
    }
    makeDirectoriesWritable(path);
    rmSync(path, { recursive: true });
    result.removed.push(path);
  }
  return result;
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: {
      'state-root': { type: 'string' },
      'current-bundle': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    } });
    const result = pruneDevelopmentBundles({
      stateRoot: values['state-root'], currentBundle: values['current-bundle'], dryRun: values['dry-run'],
    });
    console.log(`Development bundle cleanup: ${values['dry-run'] ? `would remove ${result.candidates.length}` : `removed ${result.removed.length}`}; retained ${result.retained} (${result.active} referenced by running processes); ignored ${result.ignored} unverified or staging entries.`);
  } catch (error) {
    console.error(`Development bundle cleanup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
