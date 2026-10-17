#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const generator = 'internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs';
const packageRoot = 'internal/envapp/ui_src';
const inputs = new Set([
  generator,
  `${packageRoot}/package.json`,
  `${packageRoot}/pnpm-lock.yaml`,
  `${packageRoot}/src/ui/services/hostApplicationPresentation.ts`,
  'desktop/src/shared/floeStandaloneStyles.generated.ts',
  'scripts/check_staged_viewer_assets.mjs',
  'scripts/local_gate_commit_checks.sh',
]);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const changed = git('diff', '--cached', '--name-only', '--no-renames', '-z').split('\0').filter(Boolean);
const relevant = changed.some((name) => inputs.has(name)
  || name.startsWith(`${packageRoot}/src/ui/i18n/`)
  || name.startsWith('internal/flower_ui/src/i18n/')
  || ['host_application_viewer', 'remote_desktop_viewer'].some((viewer) =>
    path.posix.dirname(name) === `internal/codeapp/appserver/${viewer}` && /\.generated\.(js|css)$/.test(name)));

if (!relevant) {
  console.log('[INFO] Viewer assets: no staged inputs changed');
  process.exit(0);
}

const root = git('rev-parse', '--show-toplevel').trim();
const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-staged-viewers-'));
try {
  // Check the complete index so unstaged generated files cannot hide stale assets.
  execFileSync('git', ['checkout-index', '--all', `--prefix=${snapshot}${path.sep}`], { cwd: root });
  const installed = path.join(root, packageRoot, 'node_modules');
  if (!fs.existsSync(installed)) throw new Error('Locked Env App dependencies are not installed.');
  fs.symlinkSync(installed, path.join(snapshot, packageRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const env = { ...process.env };
  for (const key of git('rev-parse', '--local-env-vars').trim().split('\n')) delete env[key];
  console.log('[INFO] Viewer assets: checking staged content');
  const result = spawnSync(process.execPath, [path.join(snapshot, generator), '--check'], {
    cwd: snapshot, env, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Staged viewer asset verification failed.');
} catch (error) {
  console.error(`[ERROR] ${error.message}`);
  console.error('Prepare locked dependencies with pnpm install --frozen-lockfile in internal/envapp/ui_src.');
  console.error(`From the repository root, run node ${generator}, then git add the matching source and generated files.`);
  console.error('This check does not install dependencies, regenerate assets, or change the index.');
  process.exitCode = 1;
} finally {
  fs.rmSync(snapshot, { recursive: true, force: true });
}
