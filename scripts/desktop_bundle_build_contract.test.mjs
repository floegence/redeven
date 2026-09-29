import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(new URL('./build_desktop_bundled_runtime.sh', import.meta.url), 'utf8');

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
