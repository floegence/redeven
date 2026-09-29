import { stageBrowserExtension } from './stage_browser_extension.mjs';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  if (process.versions.node !== expectedNode || !['darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    throw new Error(`Computer resources require Node ${expectedNode} and a supported Runtime target.`);
  }
  // Linux helpers are JavaScript/Wasm plus a checksum-verified official Node
  // binary. Darwin also includes a native Swift helper and needs a native build.
  const nativeTarget = platform === process.platform && arch === process.arch;
  if (platform === 'darwin' && !nativeTarget) {
    throw new Error('Darwin computer resources require a matching native builder.');
  }
  if (existsSync(destination)) throw new Error('Computer resource destination must be new.');
  const requireUI = createRequire(path.join(repo, 'internal/envapp/ui_src/package.json'));
  const catalog = JSON.parse(readFileSync(path.join(repo, 'internal/browserinstall/catalog.json')));
  if (requireUI('playwright/package.json').version !== catalog.playwright_version) throw new Error('Browser catalog must match the published Playwright version.');
  mkdirSync(destination, { recursive: true });
  stageBrowserExtension(path.join(destination, "extension"));
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
    if (nativeTarget && execFileSync(path.join(destination, 'node'), ['--version'], { encoding: 'utf8' }).trim() !== `v${expectedNode}`) throw new Error('Bundled Node version mismatch.');
  } finally { rmSync(downloadRoot, { recursive: true, force: true }); }
  for (const file of ['redevenComputerHost.mjs', 'redevenBrowserInventory.mjs', 'redevenManagedBrowser.mjs', 'redevenBrowserHost.mjs', 'computerBrowserHost.mjs', 'computerManagedDownloads.mjs', 'computerBrowserLineage.mjs', 'computerExtensionTransport.mjs', 'computerBrowserSource.mjs', 'computerBrowserPage.mjs', 'computerBrowserController.mjs', 'computerBrowserKeys.mjs', 'redevenComputerScript.mjs']) {
    copy(path.join(repo, 'internal/envapp/ui_src/scripts', file), file);
  }
  const copiedPackages = new Map();
  function copyRuntimePackage(name, resolveFrom) {
    // Package metadata is needed for staging, not a CommonJS entrypoint.
    // ESM-only SDKs and packages with private manifests use the same installed
    // dependency search paths, including pnpm's resolved symlink graph.
    const packageFile = (resolveFrom.resolve.paths(name) ?? [])
      .map(directory => path.join(directory, name, 'package.json'))
      .find(candidate => existsSync(candidate));
    if (!packageFile) throw new Error(`Runtime package metadata missing: ${name}`);
    const metadata = JSON.parse(readFileSync(packageFile, 'utf8'));
    if (metadata.name !== name) throw new Error(`Runtime package identity mismatch: ${name}`);
    if (copiedPackages.has(name)) {
      if (copiedPackages.get(name) !== metadata.version) throw new Error(`Conflicting runtime dependency: ${name}`);
      return;
    }
    copiedPackages.set(name, metadata.version);
    copy(path.dirname(packageFile), `node_modules/${name}`);
    for (const dependency of Object.keys(metadata.dependencies || {})) copyRuntimePackage(dependency, createRequire(realpathSync(packageFile)));
  }
  copyRuntimePackage('quickjs-emscripten', requireUI);
  copyRuntimePackage('@floegence/floebrowser', requireUI);
  for (const name of ['playwright', 'playwright-core']) {
    const packageFile = name === 'playwright'
      ? requireUI.resolve(`${name}/package.json`)
      : createRequire(requireUI.resolve('playwright/package.json')).resolve(`${name}/package.json`);
    copy(path.dirname(packageFile), `node_modules/${name}`);
  }
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
      else throw new Error(`Unsupported computer resource: ${relative}`);
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
