import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { captureSourceBuildIdentity, verifySourceBuildIdentity } from './source_build_identity.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const packages = ['desktop', 'internal/envapp/ui_src', 'internal/codeapp/ui_src'];
const volatileDependencyDirectories = new Set(['.cache', '.vite', '.vite-temp']);

// Hash bytes, names, types and executable bits. Do not trust timestamps, Git
// status, or an unchanged receipt when outputs/dependencies have been edited.
export function treeDigest(root, { dependencies = false } = {}) {
  const digest = createHash('sha256');
  const boundary = path.resolve(root);
  function walk(file, name) {
    const stat = lstatSync(file);
    digest.update(JSON.stringify([name, stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'link' : 'file', stat.mode & 0o111]) + '\0');
    if (stat.isSymbolicLink()) {
      if (!dependencies) throw new Error('Build outputs cannot contain symlinks: ' + name);
      const target = realpathSync(file);
      if (target !== boundary && !target.startsWith(boundary + path.sep)) throw new Error('Dependency link leaves its package: ' + name);
      digest.update(readlinkSync(file));
    } else if (stat.isDirectory()) {
      for (const child of readdirSync(file).sort()) {
        if (dependencies && volatileDependencyDirectories.has(child)) continue;
        walk(path.join(file, child), name + '/' + child);
      }
    } else if (stat.isFile()) digest.update(readFileSync(file));
    else throw new Error('Unsupported build entry: ' + name);
    digest.update('\0');
  }
  walk(boundary, '.');
  return digest.digest('hex');
}

function probe(root, executable, args) {
  return execFileSync(executable, args, { cwd: root, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function buildGoEnvironment(root) {
  const environment = JSON.parse(probe(root, 'go', ['env', '-json']));
  // GOGCCFLAGS contains a newly allocated temporary directory on every probe.
  // Its effective inputs (CC, GOOS/ARCH and CGO flags) remain in this object.
  delete environment.GOGCCFLAGS;
  return environment;
}

export function captureBuildContext(root) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(GO|CGO_|RUST|CARGO|VITE_|npm_config_|PNPM|REDEVEN_ASSET_BUILD_PROFILE$|REDEVEN_DESKTOP_BUNDLE_|REDEVEN_DESKTOP_(RUNTIME|AGENT)_TARBALL$|REDEVEN_NODE_ARCHIVE$|REDEVEN_DESKTOP_VERSION$)/u.test(key)
    || /^(PATH|NODE_OPTIONS|NODE_ENV|CC|CXX|CFLAGS|CPPFLAGS|LDFLAGS|AR|SDKROOT|DEVELOPER_DIR|MACOSX_DEPLOYMENT_TARGET|SOURCE_DATE_EPOCH|CI)$/u.test(key)
  ).sort(([a], [b]) => a.localeCompare(b)));
  const tools = {
    node: [process.execPath, process.version, process.platform, process.arch],
    go: buildGoEnvironment(root),
    npm: probe(root, 'npm', ['--version']),
    rustup: probe(root, 'rustup', ['--version']),
  };
  // The staging script owns the pinned compiler; query without installing it.
  const rustVersion = readFileSync(path.join(root, 'scripts/stage_redevplugin_release_artifacts.sh'), 'utf8').match(/^RUST_TOOLCHAIN="([^"]+)"$/mu)?.[1];
  if (!rustVersion) throw new Error('Missing pinned plugin Rust toolchain');
  tools.branch = probe(root, 'git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  tools.rust = {};
  for (const name of ['cargo', 'rustc']) {
    const found = spawnSync('rustup', ['which', '--toolchain', rustVersion, name], { cwd: root, encoding: 'utf8', env: { ...process.env, RUSTUP_AUTO_INSTALL: '0' } });
    if (found.status !== 0) tools.rust[name] = null;
    else {
      const file = found.stdout.trim();
      tools.rust[name] = [file, hash(readFileSync(file)), probe(root, file, ['--version'])];
    }
  }
  if (process.platform === 'darwin') {
    tools.swift = probe(root, '/usr/bin/swift', ['--version']);
    tools.sdk = probe(root, '/usr/bin/xcrun', ['--show-sdk-path']);
    tools.sdkSettings = hash(readFileSync(path.join(tools.sdk, 'SDKSettings.json')));
    tools.cc = probe(root, '/usr/bin/clang', ['--version']);
  } else {
    tools.cc = probe(root, process.env.CC || 'gcc', ['--version']);
    tools.cxx = probe(root, process.env.CXX || 'g++', ['--version']);
  }
  const dependencies = packages.map(directory => [directory, treeDigest(path.join(root, directory, 'node_modules'), { dependencies: true })]);
  const external = [];
  // Vite also reads ignored local environment files. Track their presence and
  // content even when Git intentionally omits them.
  for (const directory of ['desktop/src/welcome', 'internal/envapp/ui_src']) {
    for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
      const file = path.join(root, directory, name);
      external.push([directory + '/' + name, lstatSync(file, { throwIfNoEntry: false }) ? hash(readFileSync(file)) : null]);
    }
  }
  for (const key of ['REDEVEN_DESKTOP_RUNTIME_TARBALL', 'REDEVEN_DESKTOP_AGENT_TARBALL', 'REDEVEN_NODE_ARCHIVE']) {
    if (process.env[key]) external.push([key, hash(readFileSync(process.env[key]))]);
  }
  return { schema: 1, root: realpathSync(root), source: captureSourceBuildIdentity(root), environment, tools, dependencies, external };
}

export function verifyBuildContexts(before, after) {
  // Installing a previously absent pinned Rust toolchain is the sole allowed
  // preparation change. Never admit changed sources, dependencies or settings.
  const comparable = structuredClone(after);
  for (const name of ['cargo', 'rustc']) {
    if (before.tools.rust[name] === null) comparable.tools.rust[name] = null;
  }
  if (JSON.stringify(before) !== JSON.stringify(comparable)) throw new Error('Build inputs changed during preparation; rerun from a stable checkout.');
}

export function buildInputKey(context) { return hash(JSON.stringify(context)); }

function receiptPath(stateRoot) { return path.join(stateRoot, 'desktop/dev-build-v1.json'); }
function bundleRoot(stateRoot, name) {
  if (!/^[a-f0-9]{64}$/u.test(name || '')) throw new Error('Invalid cached bundle identity');
  return path.join(stateRoot, 'desktop/bundles', name);
}
function outputs(root, bundle) {
  // Desktop executes from dist; Runtime runs the self-contained immutable
  // snapshot. Embedded asset directories are not consulted on this fast path.
  return { desktop: treeDigest(path.join(root, 'desktop/dist')), bundle: treeDigest(bundle) };
}

export function lookupBuild(root, stateRoot, context) {
  try {
    const receipt = JSON.parse(readFileSync(receiptPath(stateRoot), 'utf8'));
    if (receipt.schema !== 1 || receipt.input !== buildInputKey(context)) return { reason: 'source, dependencies or build environment changed' };
    const bundle = bundleRoot(stateRoot, receipt.bundle);
    if (hash(readFileSync(path.join(bundle, 'desktop-bundle-manifest.json'))) !== receipt.bundle) return { reason: 'bundle manifest changed' };
    if (JSON.stringify(outputs(root, bundle)) !== JSON.stringify(receipt.outputs)) return { reason: 'built files changed' };
    verifySourceBuildIdentity(root, context.source);
    return { bundle };
  } catch (error) {
    if (/Source changed/u.test(error.message)) throw error;
    return { reason: 'no complete verified build is available' };
  }
}

export function recordBuild(root, stateRoot, context, bundle) {
  if (path.resolve(bundle) !== bundleRoot(stateRoot, path.basename(bundle))) throw new Error('Build must belong to this development profile');
  verifySourceBuildIdentity(root, context.source);
  const receipt = { schema: 1, input: buildInputKey(context), bundle: path.basename(bundle), outputs: outputs(root, bundle) };
  const file = receiptPath(stateRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp.' + process.pid;
  writeFileSync(temporary, JSON.stringify(receipt) + '\n', { mode: 0o600 });
  renameSync(temporary, file);
}

if (import.meta.main) {
  try {
    const [operation, root, stateRoot, input, bundle] = process.argv.slice(2);
    if (operation === 'capture') console.log(JSON.stringify(captureBuildContext(root)));
    else if (operation === 'key') console.log(buildInputKey(JSON.parse(input)));
    else if (operation === 'lookup') {
      const result = lookupBuild(root, stateRoot, JSON.parse(input));
      if (result.bundle) console.log(result.bundle);
      else console.error('[dev-build] Rebuild required: ' + result.reason + '.');
    } else if (operation === 'compare') verifyBuildContexts(JSON.parse(input), JSON.parse(bundle));
    else if (operation === 'record') recordBuild(root, stateRoot, JSON.parse(input), bundle);
    else throw new Error('Expected capture, key, lookup, compare or record');
  } catch (error) {
    console.error('[dev-build] ' + error.message);
    process.exitCode = 1;
  }
}
