#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalGoVersion } from './check_go_version_consistency.mjs';

const noticeInputs = new Set([
  'THIRD_PARTY_NOTICES.md',
  'go.mod',
  'go.sum',
  '.githooks/pre-commit',
  'scripts/check_staged_third_party_notices.mjs',
  'scripts/check_go_version_consistency.mjs',
  'scripts/generate_third_party_notices.mjs',
  'scripts/javascript_lock_inventory.mjs',
  'scripts/terminal_agent_icon_integrity.mjs',
  'scripts/model-catalog/models-dev.LICENSE',
  'assets/terminal_agent_icons.json',
  'assets/container_service_icons.json',
  'assets/environment_platform_icons.json',
  'scripts/environment_platform_icon_integrity.mjs',
]);
const assetRoots = [
  'desktop/src/welcome/assets/environment-platform-icons/',
  'assets/licenses/',
  'internal/envapp/ui_src/public/agent-cli-icons/',
  'internal/envapp/ui_src/public/container-service-icons/',
];
const packageRoots = ['desktop', 'internal/envapp/ui_src', 'internal/codeapp/ui_src'];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const changed = git('diff', '--cached', '--name-only', '--no-renames', '-z').split('\0').filter(Boolean);
const relevant = changed.some((name) => noticeInputs.has(name)
  || assetRoots.some((root) => name.startsWith(root))
  || packageRoots.some((root) => ['package.json', 'package-lock.json', 'pnpm-lock.yaml'].some((file) => name === `${root}/${file}`)));

if (!relevant) {
  console.log('[INFO] Third-party notices: no staged inputs changed');
  process.exit(0);
}

const root = git('rev-parse', '--show-toplevel').trim();
const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-staged-notices-'));
try {
  // Export the index, not HEAD or the working files. This also preserves partial staging.
  // Use the entire tracked tree so the generator owns its input graph in one place.
  execFileSync('git', ['checkout-index', '--all', `--prefix=${snapshot}${path.sep}`], { cwd: root });
  for (const packageRoot of packageRoots) {
    const installed = path.join(root, packageRoot, 'node_modules');
    if (!fs.existsSync(installed)) continue;
    const target = path.join(snapshot, packageRoot, 'node_modules');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(installed, target, process.platform === 'win32' ? 'junction' : 'dir');
  }

  const env = { ...process.env };
  for (const key of git('rev-parse', '--local-env-vars').trim().split('\n')) delete env[key];
  Object.assign(env, {
    GOWORK: 'off',
    GO111MODULE: 'on',
    GOFLAGS: '',
    GOPROXY: 'off',
    GOSUMDB: 'off',
    GOVCS: '*:off',
    GOTOOLCHAIN: 'local',
  });
  // Read the launcher without automatic switching: Go refuses SDK checksum
  // verification with GOSUMDB=off even when that SDK is already installed.
  const installed = JSON.parse(execFileSync('go', ['env', '-json', 'GOROOT', 'GOVERSION', 'GOMODCACHE', 'GOHOSTOS', 'GOHOSTARCH'], {
    cwd: snapshot,
    env,
    encoding: 'utf8',
  }));
  const expectedVersion = `go${canonicalGoVersion(snapshot)}`;
  const goRoot = installed.GOVERSION === expectedVersion
    ? installed.GOROOT
    : path.join(installed.GOMODCACHE, `golang.org/toolchain@v0.0.1-${expectedVersion}.${installed.GOHOSTOS}-${installed.GOHOSTARCH}`);
  const goBinary = path.join(goRoot, 'bin', process.platform === 'win32' ? 'go.exe' : 'go');
  if (!fs.existsSync(goBinary)) {
    throw new Error('The staged module Go toolchain is not installed; prepare it before committing.');
  }
  env.PATH = path.join(goRoot, 'bin') + path.delimiter + (env.PATH ?? '');
  env.GOROOT = goRoot;
  const actualVersion = execFileSync(goBinary, ['env', 'GOVERSION'], { cwd: snapshot, env, encoding: 'utf8' }).trim();
  if (actualVersion !== expectedVersion) {
    throw new Error(`The installed Go toolchain reports ${actualVersion}, expected ${expectedVersion}.`);
  }
  console.log('[INFO] Third-party notices: checking staged content offline');
  const result = spawnSync(process.execPath, [path.join(snapshot, 'scripts/generate_third_party_notices.mjs'), '--check'], {
    cwd: snapshot,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Staged third-party notice verification failed.');
} catch (error) {
  console.error(`[ERROR] ${error.message}`);
  console.error('Prepare the locked dependencies and Go module cache, then run node scripts/generate_third_party_notices.mjs.');
  console.error('If dependencies are missing, install with pnpm install --frozen-lockfile in desktop and internal/envapp/ui_src.');
  console.error('Prepare the Go version declared by the staged go.mod before retrying; the hook only uses installed toolchains.');
  console.error('Use git add to stage the matching dependency inputs and THIRD_PARTY_NOTICES.md, then retry the commit.');
  console.error('This hook does not download dependencies, regenerate notices, or change the index.');
  process.exitCode = 1;
} finally {
  fs.rmSync(snapshot, { recursive: true, force: true });
}
