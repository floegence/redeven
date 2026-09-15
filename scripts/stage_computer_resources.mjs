import { cpSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNodeArchive } from './resolve_node_archive.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Both development snapshots and installers consume these exact resources.
// Missing dependencies fail the build; source directories and user caches are
// never consulted by the running helper.
export function stageComputerResources(destination, platform = process.platform, arch = process.arch) {
  if (!path.isAbsolute(destination)) throw new Error('Computer resource destination must be absolute.');
  const expectedNode = readFileSync(path.join(repo, '.node-version'), 'utf8').trim();
  if (platform !== process.platform || arch !== process.arch || process.versions.node !== expectedNode) {
    throw new Error(`Computer resources require a native ${platform}/${arch} builder with Node ${expectedNode}.`);
  }
  if (existsSync(destination)) throw new Error('Computer resource destination must be new.');
  const requireUI = createRequire(path.join(repo, 'internal/envapp/ui_src/package.json'));
  const { chromium } = requireUI('playwright');
  const browserExecutable = chromium.executablePath();
  if (!existsSync(browserExecutable)) throw new Error('Playwright Chromium is missing. Run pnpm exec playwright install chromium in the Env App workspace before building.');
  mkdirSync(destination, { recursive: true });
  function copyTree(source, target) {
    const resolved = realpathSync(source);
    if (lstatSync(resolved).isDirectory()) {
      mkdirSync(target, { recursive: true });
      for (const name of readdirSync(resolved)) copyTree(path.join(resolved, name), path.join(target, name));
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(resolved, target);
    }
  }
  const copy = (source, target) => copyTree(source, path.join(destination, target));
  const archiveName = `node-v${expectedNode}-${platform}-${arch}.tar.gz`;
  const downloadRoot = path.join(destination, '.node-download');
  mkdirSync(downloadRoot);
  try {
    const archive = resolveNodeArchive({ version: expectedNode, platform, arch });
    const prefix = archiveName.slice(0, -7);
    execFileSync('tar', ['-xzf', archive, '-C', downloadRoot, `${prefix}/bin/node`, `${prefix}/LICENSE`]);
    copy(path.join(downloadRoot, prefix, 'bin/node'), 'node');
    copy(path.join(downloadRoot, prefix, 'LICENSE'), 'NODE_LICENSE');
    if (execFileSync(path.join(destination, 'node'), ['--version'], { encoding: 'utf8' }).trim() !== `v${expectedNode}`) throw new Error('Bundled Node version mismatch.');
  } finally { rmSync(downloadRoot, { recursive: true, force: true }); }
  copy(path.join(repo, 'internal/envapp/ui_src/scripts/redevenComputerHost.mjs'), 'redevenComputerHost.mjs');
  for (const name of ['playwright', 'playwright-core']) {
    const packageFile = name === 'playwright'
      ? requireUI.resolve(`${name}/package.json`)
      : createRequire(requireUI.resolve('playwright/package.json')).resolve(`${name}/package.json`);
    copy(path.dirname(packageFile), `node_modules/${name}`);
  }
  // A macOS executable depends on its containing app/framework; Linux depends
  // on sibling libraries. Copy the complete Chromium distribution, not one file.
  let browserRoot = path.dirname(browserExecutable);
  if (platform === 'darwin') {
    while (!browserRoot.endsWith('.app')) {
      const parent = path.dirname(browserRoot);
      if (parent === browserRoot) throw new Error('Chromium app bundle was not found.');
      browserRoot = parent;
    }
  }
  const browserDirectory = path.join('chromium', path.basename(browserRoot));
  cpSync(browserRoot, path.join(destination, browserDirectory), { recursive: true, verbatimSymlinks: true });
  const browserRelativePath = path.posix.join(browserDirectory, path.relative(browserRoot, browserExecutable).split(path.sep).join('/'));
  writeFileSync(path.join(destination, 'browser.json'), `${JSON.stringify({ executable: browserRelativePath })}\n`);
  if (platform === 'darwin') {
    const nativePackage = path.join(repo, 'desktop/native/computer-host');
    execFileSync('/usr/bin/swift', ['build', '-c', 'release', '--package-path', nativePackage], { stdio: 'inherit' });
    copy(path.join(nativePackage, '.build/release/redeven-computer-host'), 'redeven-computer-host');
  }
  const files = [];
  function inventory(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = prefix + name;
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) inventory(absolute, relative + '/');
      else if (stat.isFile()) files.push({ path: relative, sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex'), size_bytes: stat.size, executable: Boolean(stat.mode & 0o111) });
      else if (stat.isSymbolicLink() && relative.startsWith('chromium/')) {
        const link = readlinkSync(absolute);
        const resolved = realpathSync(absolute);
        if (path.isAbsolute(link) || !resolved.startsWith(realpathSync(destination) + path.sep)) throw new Error(`Computer resource symlink escapes bundle: ${relative}`);
        files.push({ path: relative, link_target: link });
      } else throw new Error(`Unsupported computer resource: ${relative}`);
    }
  }
  inventory(destination);
  writeFileSync(path.join(destination, 'manifest.json'), `${JSON.stringify({ schema_version: 1, platform, architecture: arch, node_version: expectedNode, files })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    stageComputerResources(path.resolve(process.argv[2]), process.argv[3], process.argv[4]);
  } catch (error) {
    console.error(`[ERROR] Computer resource staging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
