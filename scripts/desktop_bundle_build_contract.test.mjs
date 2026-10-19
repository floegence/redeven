import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { captureSourceBuildIdentity, verifySourceBuildIdentity } from './source_build_identity.mjs';

const source = readFileSync(new URL('./build_desktop_bundled_runtime.sh', import.meta.url), 'utf8');

test('accepts stable dirty sources, ignores build output, and rejects later edits or stale commit labels', () => {
  const root = mkdtempSync(join(tmpdir(), 'redeven-source-build-'));
  try {
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git('init', '-q');
    git('config', 'user.name', 'Build fixture');
    git('config', 'user.email', 'build@example.invalid');
    writeFileSync(join(root, '.gitignore'), 'dist/\n');
    writeFileSync(join(root, 'flower.ts'), 'original');
    git('add', '.'); git('commit', '-qm', 'fixture');
    const commit = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'flower.ts'), 'intentional local edit');
    writeFileSync(join(root, 'new input.ts'), 'new source');
    const identity = captureSourceBuildIdentity(root, commit);
    git('add', '.');
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist', 'asset.js'), 'built output');
    assert.doesNotThrow(() => verifySourceBuildIdentity(root, identity));
    writeFileSync(join(root, 'flower.ts'), 'changed after asset build');
    assert.throws(() => verifySourceBuildIdentity(root, identity), /source changed during build/iu);
    writeFileSync(join(root, 'flower.ts'), 'intentional local edit');
    assert.doesNotThrow(() => verifySourceBuildIdentity(root, identity));
    rmSync(join(root, 'new input.ts'));
    assert.throws(() => verifySourceBuildIdentity(root, identity), /source changed during build/iu);
    const deletedIdentity = captureSourceBuildIdentity(root);
    git('add', '-u');
    assert.doesNotThrow(() => verifySourceBuildIdentity(root, deletedIdentity));
    chmodSync(join(root, 'flower.ts'), 0o755);
    assert.throws(() => verifySourceBuildIdentity(root, deletedIdentity), /source changed during build/iu);
    chmodSync(join(root, 'flower.ts'), 0o644);
    symlinkSync('flower.ts', join(root, 'source-link'));
    const symlinkIdentity = captureSourceBuildIdentity(root);
    rmSync(join(root, 'source-link'));
    symlinkSync('.gitignore', join(root, 'source-link'));
    assert.throws(() => verifySourceBuildIdentity(root, symlinkIdentity), /source changed during build/iu);
    git('add', '.'); git('commit', '-qm', 'advance');
    assert.throws(() => captureSourceBuildIdentity(root, commit), /requested commit/iu);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const phase of ['assets', 'runtime']) test(`rejects a checkout advance during ${phase} compilation`, () => {
  const root = mkdtempSync(join(tmpdir(), 'redeven-mixed-source-'));
  try {
    const scripts = join(root, 'scripts');
    mkdirSync(scripts);
    const originalScripts = fileURLToPath(new URL('.', import.meta.url));
    for (const name of readdirSync(originalScripts).filter(name => /^(?:ui_package_common|source_build_identity)\./u.test(name))) {
      writeFileSync(join(scripts, name), readFileSync(join(originalScripts, name)));
    }
    writeFileSync(join(root, 'flower.ts'), 'export const compactionTurn = false;\n');
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git('init', '-q');
    git('config', 'user.name', 'Build fixture');
    git('config', 'user.email', 'build@example.invalid');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    const entrypoint = '\nmain "$@"';
    const script = join(scripts, 'build_desktop_bundled_runtime.sh');
    const advanceCheckout = `
printf '%s\\n' 'export const compactionTurn = true;' > "$ROOT_DIR/flower.ts"
git -C "$ROOT_DIR" add flower.ts
git -C "$ROOT_DIR" commit -qm 'advance checkout while building'
`;
    writeFileSync(script, `${source.slice(0, source.lastIndexOf(entrypoint))}
build_go_command() {
  printf 'compiled\\n' > "$ROOT_DIR/compiled"
  ${phase === 'runtime' ? advanceCheckout : ''}
}
bundle_from_source darwin arm64 "$ROOT_DIR/runtime" v0.0.0-dev "$FIXTURE_COMMIT"
`);
    writeFileSync(join(scripts, 'build_runtime_binary.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(scripts, 'build_assets.sh'), `#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
ROOT_DIR="$PWD"
${phase === 'assets' ? advanceCheckout : ''}
`, { mode: 0o755 });
    const result = spawnSync('/bin/bash', [script], { cwd: root, encoding: 'utf8',
      env: { ...process.env, FIXTURE_COMMIT: git('rev-parse', '--short=12', 'HEAD') } });
    assert.notEqual(result.status, 0, 'a mixed source bundle must never succeed');
    assert.match(result.stderr, /source changed during build/iu);
    assert.equal(readdirSync(root).includes('compiled'), phase === 'runtime', 'reject asset drift before compiling the backend');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failed Desktop bundle preserves its error and removes only its staging directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'redeven-bundle-cleanup-'));
  try {
    const scripts = join(root, 'scripts');
    const output = join(root, "existing user's bundles");
    mkdirSync(scripts);
    mkdirSync(join(output, 'darwin-arm64'), { recursive: true });
    mkdirSync(join(output, '.another-task.stage.keep'));
    writeFileSync(join(output, 'darwin-arm64', 'sentinel'), 'existing bundle');
    writeFileSync(join(scripts, 'ui_package_common.sh'), readFileSync(new URL('./ui_package_common.sh', import.meta.url)));
    const script = join(scripts, 'build_desktop_bundled_runtime.sh');
    const entrypoint = '\nmain "$@"';
    assert.ok(source.endsWith(`${entrypoint}\n`));
    writeFileSync(script, `${source.slice(0, source.lastIndexOf(entrypoint))}
bundle_from_tarball() {
  /bin/sh -c 'echo "fixture signature verification failed" >&2; exit 23'
}
main "$@"
`);
    const result = spawnSync('/bin/bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        REDEVEN_DESKTOP_BUNDLE_GOOS: 'darwin',
        REDEVEN_DESKTOP_BUNDLE_GOARCH: 'arm64',
        REDEVEN_DESKTOP_BUNDLE_OUTPUT_DIR: join(output, 'darwin-arm64'),
        REDEVEN_DESKTOP_BUNDLE_VERSION: '0.1.0',
        REDEVEN_DESKTOP_BUNDLE_COMMIT: '123456789abc',
        REDEVEN_DESKTOP_RUNTIME_TARBALL: join(root, 'redeven_darwin_arm64.tar.gz'),
      },
    });
    assert.equal(result.status, 23, result.stderr);
    assert.match(result.stderr, /fixture signature verification failed/u);
    assert.doesNotMatch(result.stderr, /unbound variable/u);
    assert.deepEqual(readdirSync(output).sort(), ['.another-task.stage.keep', 'darwin-arm64']);
    assert.equal(readFileSync(join(output, 'darwin-arm64', 'sentinel'), 'utf8'), 'existing bundle');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Desktop bundle binaries and manifest share the Desktop package identity', () => {
  assert.match(source, /resolve_bundle_version\(\)/u);
  assert.match(source, /require\(process\.argv\[1\]\)\.version/u);
  assert.match(source, /bundle_version="\$\(resolve_bundle_version\)"/u);
  assert.match(
    source,
    /bundle_from_source "\$goos" "\$goarch" "\$working_bundle_path" "\$bundle_version" "\$bundle_commit"/u,
  );
  assert.doesNotMatch(source, /REDEVEN_DESKTOP_GATEWAY_TARBALL/u);
  assert.doesNotMatch(source, /REDEVEN_DESKTOP_VERSION:-0\.0\.0-dev/u);
});

test('Windows Desktop validates and preserves one exact Linux x64 managed WSL archive', () => {
  assert.match(source, /assert_tarball_target "\$tarball_path" linux amd64 "Redeven managed WSL runtime archive"/u);
  assert.match(source, /bundle_from_tarball "\$tarball_path" "\$inspection_bundle" linux/u);
  assert.match(source, /assert_go_binary_target "\$inspection_bundle\/redeven" linux amd64/u);
  assert.match(source, /assert_go_binary_build_identity "\$inspection_bundle\/redeven" "\$bundle_version" "\$bundle_commit"/u);
  assert.match(source, /cp "\$tarball_path" "\$working_bundle_path"/u);
  assert.match(source, /managed_wsl_runtime: managedWSLArchive \? \{/u);
  assert.match(source, /platform: "linux"/u);
  assert.match(source, /architecture: "amd64"/u);
  assert.match(source, /archive_files: managedWSLArchiveFiles/u);
});

test('every native Desktop bundle stages the complete published ReDevPlugin runtime suite', () => {
  assert.match(source, /if \[\[ "\$goos" != "windows" \]\]; then\n\s+stage_redevplugin_runtime/u);
  assert.match(source, /if \[\[ "\$goos" != "windows" \]\]; then\n\s+allow_args\+=/u);
  assert.match(source, /platform !== "windows"[\s\S]*\["redevplugin-runtime", true\]/u);
});
